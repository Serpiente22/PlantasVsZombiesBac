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

    if (!data.color) return; // <-- evita errores

    if (game.players.find(p => p.id === data.id)) return;

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

    // Sync players
    game.players = room.players.map(p => ({
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

    const value = Math.floor(Math.random() * 6) + 1;
    game.dice = value;
    return value;
  }

  movePiece(roomId: string, playerId: string, pieceIndex: number) {
    const game = this.games.get(roomId);
    if (!game) return false;

    const player = game.players.find(p => p.id === playerId);
    if (!player) return false;

    const dice = game.dice ?? 0;
    if (dice <= 0) return false;

    const pos = player.pieces[pieceIndex];

    if (pos === -1) {
      if (dice !== 6) return false;
      player.pieces[pieceIndex] = this.startSquare(player.color);
    } else {
      player.pieces[pieceIndex] = (pos + dice) % 52;
    }

    game.dice = null;
    return true;
  }

  advanceTurn(roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return;

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
    const room = this.rooms.findRoomByPlayer(id);
    this.rooms.removePlayerFromRoom(id);

    for (const [roomId, game] of this.games.entries()) {
      const index = game.players.findIndex(p => p.id === id);
      if (index !== -1) game.players.splice(index, 1);

      if (game.players.length === 0) this.games.delete(roomId);
    }
  }
}
