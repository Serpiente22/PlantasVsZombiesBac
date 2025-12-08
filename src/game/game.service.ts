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
  pieces: number[];
}

interface GameState {
  roomId: string;
  players: LudoPlayerState[];
  turnIndex: number;
  dice: number | null;
  status: 'waiting' | 'in-progress' | 'finished';
  maxPlayers: number;
}

@Injectable()
export class GameService {
  private games: Map<string, GameState> = new Map();

  constructor(private readonly rooms: RoomsService) {}

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
    };

    this.games.set(roomId, game);
    return game;
  }

  addPlayerToGame(roomId: string, data: { id: string; name: string; color: Color }) {
    const game = this.games.get(roomId);
    if (!game) return;

    if (!data.color) return;
    // Evitar duplicados pero permitir actualizar datos si es necesario
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

    // Reiniciar estado para partida nueva
    game.players = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      pieces: [-1, -1, -1, -1],
    }));

    game.status = 'in-progress';
    game.turnIndex = 0;
    game.dice = null;

    server.to(roomId).emit('gameStarted', this.getPublicGameState(roomId));
  }

  rollDice(roomId: string): number | null {
    const game = this.games.get(roomId);
    if (!game || game.status !== 'in-progress') return null;
    
    // Si ya había tirado y no movió, no debería tirar de nuevo, 
    // pero aquí asumimos que el frontend controla el botón.
    const value = Math.floor(Math.random() * 6) + 1;
    game.dice = value;
    return value;
  }

  // Verifica si el jugador actual tiene ALGUN movimiento posible con el dado actual
  hasAnyValidMove(roomId: string): boolean {
    const game = this.games.get(roomId);
    if (!game || game.dice === null) return false;

    const player = game.players[game.turnIndex];
    if (!player) return false;

    // Verificar cada ficha
    for (let i = 0; i < player.pieces.length; i++) {
      const pos = player.pieces[i];
      // Si está en casa (-1), necesita un 6 para salir
      if (pos === -1) {
        if (game.dice === 6) return true;
      } else {
        // Si está en el tablero, verificamos que no se pase de la meta (simplificado a 51 por ahora)
        // Aquí puedes agregar lógica más compleja de meta si la tienes
        if (pos + game.dice <= 56) return true; // Suponiendo 56 como fin del recorrido
      }
    }
    return false;
  }

  movePiece(roomId: string, playerId: string, pieceIndex: number) {
    const game = this.games.get(roomId);
    if (!game) return false;

    const player = game.players.find((p) => p.id === playerId);
    if (!player) return false;
    if (pieceIndex < 0 || pieceIndex > 3) return false;

    const dice = game.dice ?? 0;
    if (dice <= 0) return false;

    const pos = player.pieces[pieceIndex];

    if (pos === -1) {
      if (dice !== 6) return false; // Solo sale con 6
      player.pieces[pieceIndex] = this.startSquare(player.color);
    } else {
      // Mover ficha
      // Nota: Aquí deberías implementar la lógica de comer fichas y entrar a la meta de colores
      // Por ahora mantenemos tu lógica circular básica
      player.pieces[pieceIndex] = (pos + dice) % 52;
    }

    game.dice = null; // Consumir el dado
    return true;
  }

  advanceTurn(roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return;

    game.dice = null; // Asegurar que el dado se resetee
    game.turnIndex = (game.turnIndex + 1) % game.players.length;
  }

  startSquare(color: Color) {
    return {
      red: 0,
      blue: 13,
      yellow: 26,
      green: 39,
    }[color];
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
    };
  }

  getGame(roomId: string) {
    return this.games.get(roomId);
  }

  removePlayer(id: string) {
    this.rooms.removePlayerFromRoom(id);
    for (const [roomId, game] of this.games.entries()) {
      const index = game.players.findIndex((p) => p.id === id);
      if (index !== -1) {
        // Opcional: convertirlo en bot o eliminarlo
        // game.players.splice(index, 1); 
        // Si eliminamos al jugador en medio de la partida, el turnIndex puede romperse.
        // Por simplicidad, no lo borramos del array 'playing' para no romper índices, 
        // o reiniciamos la sala. Aquí solo borramos si la partida no ha empezado.
        if (game.status === 'waiting') {
             game.players.splice(index, 1);
        }
      }
      if (game.players.length === 0) this.games.delete(roomId);
    }
  }
}