// src/game/game.service.ts
import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';

type Color = 'red' | 'blue' | 'green' | 'yellow';

interface PlayerState {
  id: string;
  name: string;
  color: Color;
}

interface LudoPlayerState extends PlayerState {
  // -1: Casa. 0-51: Camino principal. 
  // 100+: Recta final verde. 200+: Amarilla. 300+: Azul. 400+: Roja.
  pieces: number[]; 
}

interface GameState {
  roomId: string;
  players: LudoPlayerState[];
  turnIndex: number;
  dice: number | null;
  status: 'waiting' | 'in-progress' | 'finished';
  maxPlayers: number;
  winners: string[]; // Para guardar quién ya ganó
}

@Injectable()
export class GameService {
  private games: Map<string, GameState> = new Map();

  constructor(private readonly rooms: RoomsService) {}

  // Configuración del tablero basada en la imagen (sentido horario)
  private readonly boardConfig = {
    green:  { start: 1,  turn: 51, finalPathStart: 100 }, // Top-Left
    yellow: { start: 14, turn: 12, finalPathStart: 200 }, // Top-Right
    blue:   { start: 27, turn: 25, finalPathStart: 300 }, // Bottom-Right
    red:    { start: 40, turn: 38, finalPathStart: 400 }, // Bottom-Left
  };

  createGame(roomId: string, maxPlayers = 4): GameState | undefined {
    const room = this.rooms.getRoom(roomId);
    if (!room) return;
    if (this.games.has(roomId)) return this.games.get(roomId);

    const game: GameState = {
      roomId,
      players: [],
      turnIndex: 0,
      dice: null,
      status: 'waiting',
      maxPlayers,
      winners: [],
    };

    this.games.set(roomId, game);
    return game;
  }

  addPlayerToGame(roomId: string, data: { id: string; name: string; color: Color }) {
    const game = this.games.get(roomId);
    if (!game) return;
    if (!data.color) return;
    const existing = game.players.find((p) => p.id === data.id);
    if (existing) return;

    game.players.push({
      ...data,
      pieces: [-1, -1, -1, -1],
    });
  }

  startGame(server: Server, roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return;
    const room = this.rooms.getRoom(roomId);
    if (!room) return;

    // Ordenar jugadores para que los turnos sigan el sentido del reloj (Verde->Amarillo->Azul->Rojo)
    const colorOrder: Color[] = ['green', 'yellow', 'blue', 'red'];
    game.players = room.players
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        pieces: [-1, -1, -1, -1],
      }))
      .sort((a, b) => colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color));

    game.status = 'in-progress';
    game.turnIndex = 0;
    game.dice = null;
    game.winners = [];

    server.to(roomId).emit('gameStarted', this.getPublicGameState(roomId));
  }

  rollDice(roomId: string): number | null {
    const game = this.games.get(roomId);
    if (!game || game.status !== 'in-progress') return null;
    
    const value = Math.floor(Math.random() * 6) + 1;
    // const value = 6; // Descomentar para probar sacar fichas siempre
    game.dice = value;
    return value;
  }

  // Verifica si el movimiento es posible sin realizarlo
  canMove(pos: number, dice: number, color: Color): boolean {
    if (pos === -1) return dice === 6; // Salir de casa

    const config = this.boardConfig[color];

    // Lógica si ya está en la recta final
    if (pos >= 100) {
      const stepsToGoal = (config.finalPathStart + 5) - pos; // La meta es start + 5
      return dice <= stepsToGoal;
    }

    // Lógica en el camino principal
    // Calculamos cuántos pasos faltan para llegar al punto de giro
    let distanceToTurn = config.turn - pos;
    if (distanceToTurn < 0) distanceToTurn += 52; // Ajuste si cruza el índice 0

    if (dice > distanceToTurn) {
      // Intenta entrar a la recta final
      const stepsIntoFinal = dice - distanceToTurn - 1;
      // Solo puede entrar si no se pasa de la meta (5 pasos dentro)
      return stepsIntoFinal <= 5; 
    } else {
      // Sigue en el camino principal
      return true;
    }
  }

  hasAnyValidMove(roomId: string): boolean {
    const game = this.games.get(roomId);
    if (!game || game.dice === null) return false;
    const player = game.players[game.turnIndex];
    if (!player) return false;

    return player.pieces.some(pos => this.canMove(pos, game.dice!, player.color));
  }

  movePiece(roomId: string, playerId: string, pieceIndex: number) {
    const game = this.games.get(roomId);
    if (!game) return false;
    const player = game.players.find((p) => p.id === playerId);
    if (!player) return false;
    
    const dice = game.dice ?? 0;
    if (dice <= 0) return false;

    const currentPos = player.pieces[pieceIndex];

    if (!this.canMove(currentPos, dice, player.color)) {
        return false;
    }

    // --- Aplicar el movimiento ---
    let newPos = currentPos;
    const config = this.boardConfig[player.color];

    if (currentPos === -1) {
      // Salir de casa
      newPos = config.start;
    } else if (currentPos >= 100) {
      // Moverse dentro de la recta final
      newPos = currentPos + dice;
    } else {
      // Moverse en el camino principal
      let distanceToTurn = config.turn - currentPos;
      if (distanceToTurn < 0) distanceToTurn += 52;

      if (dice > distanceToTurn) {
        // Entrar a la recta final
        const stepsIntoFinal = dice - distanceToTurn - 1;
        newPos = config.finalPathStart + stepsIntoFinal;
      } else {
        // Seguir en el camino principal (circular)
        newPos = (currentPos + dice) % 52;
      }
    }
    
    // Actualizar posición
    player.pieces[pieceIndex] = newPos;
    game.dice = null;

    // Comer fichas (Opcional - Implementación básica)
    // Si cae en el camino principal (0-51), verificar si hay fichas de OTRO color
    if (newPos >= 0 && newPos <= 51) {
        game.players.forEach(p => {
            if (p.id !== player.id) { // No comerse a sí mismo
                p.pieces.forEach((enemyPos, idx) => {
                    if (enemyPos === newPos) {
                        // Comer: devolver a casa
                        p.pieces[idx] = -1;
                        // Aquí podrías dar un turno extra al que comió si quieres
                    }
                });
            }
        });
    }

    this.checkWinCondition(game, player);
    return true;
  }

  checkWinCondition(game: GameState, player: LudoPlayerState) {
    const config = this.boardConfig[player.color];
    const goalPos = config.finalPathStart + 5; // La posición 6 de la recta final es la meta

    // Verificar si las 4 fichas están en la meta
    const allInGoal = player.pieces.every(pos => pos === goalPos);

    if (allInGoal && !game.winners.includes(player.id)) {
        game.winners.push(player.id);
        // Si solo queda 1 jugador, el juego termina
        if (game.winners.length === game.players.length - 1 && game.players.length > 1) {
            game.status = 'finished';
        }
    }
  }

  advanceTurn(roomId: string) {
    const game = this.games.get(roomId);
    if (!game || game.status === 'finished') return;

    game.dice = null;
    
    // Buscar el siguiente jugador que no haya ganado
    let nextIndex = game.turnIndex;
    for (let i = 0; i < game.players.length; i++) {
        nextIndex = (nextIndex + 1) % game.players.length;
        const nextPlayerId = game.players[nextIndex].id;
        if (!game.winners.includes(nextPlayerId)) {
            game.turnIndex = nextIndex;
            break;
        }
    }
  }

  getPublicGameState(roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return null;

    return {
      roomId: game.roomId,
      status: game.status,
      dice: game.dice,
      turnIndex: game.turnIndex,
      players: game.players,
      winners: game.winners,
    };
  }

  getGame(roomId: string) {
    return this.games.get(roomId);
  }

  removePlayer(id: string) {
    this.rooms.removePlayerFromRoom(id);
    for (const [roomId, game] of this.games.entries()) {
      if (game.status === 'waiting') {
           const index = game.players.findIndex(p => p.id === id);
           if (index !== -1) game.players.splice(index, 1);
      }
      // Si el juego está en progreso, es complejo sacarlo sin romper los turnos.
      // Por ahora, si se desconecta en partida, su "fantasma" sigue ahí pasando turno.
      
      if (game.players.length === 0) this.games.delete(roomId);
    }
  }
}