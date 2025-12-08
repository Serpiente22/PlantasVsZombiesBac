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
  winners: string[];
}

@Injectable()
export class GameService {
  private games: Map<string, GameState> = new Map();

  constructor(private readonly rooms: RoomsService) {}

  // Configuración del tablero basada en la imagen (sentido horario)
  private readonly boardConfig = {
    green:  { start: 1,  turn: 51, finalPathStart: 100 },
    yellow: { start: 14, turn: 12, finalPathStart: 200 },
    blue:   { start: 27, turn: 25, finalPathStart: 300 },
    red:    { start: 40, turn: 38, finalPathStart: 400 },
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

    // Ordenar: Verde->Amarillo->Azul->Rojo
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
    game.dice = value;
    return value;
  }

  canMove(pos: number, dice: number, color: Color): boolean {
    if (pos === -1) return dice === 6;
    const config = this.boardConfig[color];

    if (pos >= 100) {
      const stepsToGoal = (config.finalPathStart + 5) - pos;
      return dice <= stepsToGoal;
    }

    let distanceToTurn = config.turn - pos;
    if (distanceToTurn < 0) distanceToTurn += 52;

    if (dice > distanceToTurn) {
      const stepsIntoFinal = dice - distanceToTurn - 1;
      return stepsIntoFinal <= 5; 
    }
    return true;
  }

  hasAnyValidMove(roomId: string): boolean {
    const game = this.games.get(roomId);
    if (!game || game.dice === null) return false;
    const player = game.players[game.turnIndex];
    if (!player) return false;

    return player.pieces.some(pos => this.canMove(pos, game.dice!, player.color));
  }

  // MODIFICADO: Devuelve objeto con info de si comió a alguien
  movePiece(roomId: string, playerId: string, pieceIndex: number): { success: boolean; eatenPlayerName?: string | null } {
    const game = this.games.get(roomId);
    if (!game) return { success: false };
    
    const player = game.players.find((p) => p.id === playerId);
    if (!player) return { success: false };
    
    const dice = game.dice ?? 0;
    if (dice <= 0) return { success: false };

    const currentPos = player.pieces[pieceIndex];

    if (!this.canMove(currentPos, dice, player.color)) {
        return { success: false };
    }

    let newPos = currentPos;
    const config = this.boardConfig[player.color];

    // Calcular nueva posición
    if (currentPos === -1) {
      newPos = config.start;
    } else if (currentPos >= 100) {
      newPos = currentPos + dice;
    } else {
      let distanceToTurn = config.turn - currentPos;
      if (distanceToTurn < 0) distanceToTurn += 52;

      if (dice > distanceToTurn) {
        const stepsIntoFinal = dice - distanceToTurn - 1;
        newPos = config.finalPathStart + stepsIntoFinal;
      } else {
        newPos = (currentPos + dice) % 52;
      }
    }
    
    player.pieces[pieceIndex] = newPos;
    game.dice = null;

    // --- LÓGICA DE COMER (KILL) ---
    let eatenPlayerName: string | null = null;

    // Solo se come en el camino principal (0-51)
    if (newPos >= 0 && newPos <= 51) {
        // Zonas seguras opcionales (ej: salidas). 
        // Si quieres zonas seguras, descomenta y ajusta:
        // const safeZones = [0, 8, 13, 21, 26, 34, 39, 47];
        // if (!safeZones.includes(newPos)) { ... }

        game.players.forEach(p => {
            if (p.id !== player.id) { // No comerse a sí mismo
                p.pieces.forEach((enemyPos, idx) => {
                    if (enemyPos === newPos) {
                        // ¡COMIDO!
                        p.pieces[idx] = -1; // Mandar a casa
                        eatenPlayerName = p.name;
                    }
                });
            }
        });
    }

    this.checkWinCondition(game, player);
    
    return { success: true, eatenPlayerName };
  }

  checkWinCondition(game: GameState, player: LudoPlayerState) {
    const config = this.boardConfig[player.color];
    const goalPos = config.finalPathStart + 5;
    const allInGoal = player.pieces.every(pos => pos === goalPos);

    if (allInGoal && !game.winners.includes(player.id)) {
        game.winners.push(player.id);
        if (game.winners.length === game.players.length - 1 && game.players.length > 1) {
            game.status = 'finished';
        }
    }
  }

  advanceTurn(roomId: string) {
    const game = this.games.get(roomId);
    if (!game || game.status === 'finished') return;

    game.dice = null;
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
      if (game.players.length === 0) this.games.delete(roomId);
    }
  }
}