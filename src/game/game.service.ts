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

  constructor(private readonly roomsService: RoomsService) {}

  createGame(roomId: string, maxPlayers = 4): GameState | undefined {
    const room = this.roomsService.getRoom(roomId);
    if (!room) return undefined;

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

  addPlayerToGame(roomId: string, player: { id: string; name: string; color: Color }) {
    const game = this.getGame(roomId);
    if (!game) return;

    const exists = game.players.find((p) => p.id === player.id);
    if (exists) return;

    const p: LudoPlayerState = {
      ...player,
      pieces: [-1, -1, -1, -1],
    };

    game.players.push(p);
  }

  startGame(server: Server, roomId: string) {
    const game = this.getGame(roomId);
    if (!game) return;

    if (game.players.length === 0) {
      const room = this.roomsService.getRoom(roomId);
      if (!room) return;

      for (const p of room.players) {
        this.addPlayerToGame(roomId, {
          id: p.id,
          name: p.name,
          color: p.color as Color,
        });
      }
    }

    game.status = 'in-progress';
    game.turnIndex = 0;
    game.dice = null;

    server.to(roomId).emit('gameStarted', this.getPublicGameState(roomId));
  }

  rollDice(roomId: string): number | null {
    const game = this.getGame(roomId);
    if (!game || game.status !== 'in-progress') return null;

    const value = Math.floor(Math.random() * 6) + 1;
    game.dice = value;
    return value;
  }

  movePiece(roomId: string, playerId: string, pieceIndex: number): boolean {
    const game = this.getGame(roomId);
    if (!game || game.status !== 'in-progress') return false;

    const player = game.players.find((p) => p.id === playerId);
    if (!player) return false;

    const dice = game.dice ?? 0;
    if (dice <= 0) return false;

    const piecePos = player.pieces[pieceIndex];

    if (piecePos === -1) {
      if (dice === 6) {
        player.pieces[pieceIndex] = this.startSquareForColor(player.color);
      } else {
        return false;
      }
    } else {
      player.pieces[pieceIndex] = (player.pieces[pieceIndex] + dice) % 52;
    }

    game.dice = null;
    return true;
  }

  advanceTurn(roomId: string) {
    const game = this.getGame(roomId);
    if (!game) return;

    game.turnIndex = (game.turnIndex + 1) % game.players.length;
  }

  getPublicGameState(roomId: string) {
    const game = this.getGame(roomId);
    if (!game) return null;

    return {
      roomId: game.roomId,
      status: game.status,
      dice: game.dice,
      turnIndex: game.turnIndex,
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        pieces: p.pieces,
      })),
    };
  }

  getGame(roomId: string) {
    return this.games.get(roomId);
  }

  removePlayer(clientId: string) {
    this.roomsService.removePlayerFromRoom(clientId);

    for (const [roomId, game] of this.games.entries()) {
      const idx = game.players.findIndex((p) => p.id === clientId);
      if (idx !== -1) {
        game.players.splice(idx, 1);

        if (game.players.length === 0) {
          this.games.delete(roomId);
        } else if (game.turnIndex >= game.players.length) {
          game.turnIndex = 0;
        }
      }
    }
  }

  // 🔥 FUNCIÓN QUE FALTABA
  startSquareForColor(color: Color) {
    switch (color) {
      case 'red':
        return 0;
      case 'blue':
        return 13;
      case 'yellow':
        return 26;
      case 'green':
        return 39;
      default:
        return 0;
    }
  }
}
