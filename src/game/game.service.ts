import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';

interface PlayerState {
  id: string;
  name: string;
  role: 'plant' | 'zombie';
  resources: number;
}

interface GameState {
  roomId: string;
  players: PlayerState[];
  board: Record<string, any>;
  status: 'waiting' | 'in-progress' | 'finished';
  wave: number;
  maxWaves: number;
}

@Injectable()
export class GameService {
  private games: Map<string, GameState> = new Map();

  constructor(private readonly roomsService: RoomsService) {}

  // Crear tablero inicial (45 celdas)
  private createBoard() {
    const board: Record<string, any> = {};
    for (let i = 0; i < 45; i++) {
      board[`cell-${i}`] = null;
    }
    return board;
  }

  createGame(roomId: string): GameState | undefined {
    const room = this.roomsService.getRoom(roomId);
    if (!room) return undefined;

    const game: GameState = {
      roomId,
      players: [],
      board: this.createBoard(),
      status: 'waiting',
      wave: 0,
      maxWaves: 5,
    };

    this.games.set(roomId, game);
    return game;
  }

  addPlayerToGame(roomId: string, player: PlayerState) {
    const game = this.getGame(roomId);
    if (!game) return;

    const exists = game.players.find((p) => p.id === player.id);
    if (!exists) {
      game.players.push(player);
    }
  }

  // 🔥 Iniciar juego
  startGame(server: Server, roomId: string) {
    const game = this.getGame(roomId);
    if (!game) return;

    game.status = 'in-progress';
    game.wave = 1;

    // Recursos iniciales
    for (const player of game.players) {
      player.resources = player.role === 'plant' ? 50 : 1000;
    }

    const publicState = this.getPublicGameState(roomId);

    server.to(roomId).emit('gameStarted', publicState);
  }

  // 🌱 Colocar planta
  placePlant(server: Server, roomId: string, playerId: string, plantData: any) {
    const game = this.getGame(roomId);
    if (!game) return;

    const player = game.players.find((p) => p.id === playerId);
    if (!player || player.role !== 'plant') return;

    const cost = plantData.cost ?? 50;
    if (player.resources < cost) {
      server.to(player.id).emit('notEnoughResources');
      return;
    }

    player.resources -= cost;

    game.board[plantData.position] = {
      type: 'plant',
      ...plantData,
    };

    server.to(roomId).emit('plantPlaced', {
      board: game.board,
      players: game.players,
    });
  }

  // 🧟 Colocar zombie
  placeZombie(server: Server, roomId: string, playerId: string, zombieData: any) {
    const game = this.getGame(roomId);
    if (!game) return;

    const player = game.players.find((p) => p.id === playerId);
    if (!player || player.role !== 'zombie') return;

    const cost = zombieData.cost ?? 100;
    if (player.resources < cost) {
      server.to(player.id).emit('notEnoughResources');
      return;
    }

    player.resources -= cost;

    game.board[zombieData.position] = {
      type: 'zombie',
      ...zombieData,
    };

    server.to(roomId).emit('zombiePlaced', {
      board: game.board,
      players: game.players,
    });
  }

  // ☀️ Recolectar sol
  collectSun(server: Server, roomId: string, playerId: string, amount: number) {
    const game = this.getGame(roomId);
    if (!game) return;

    const player = game.players.find((p) => p.id === playerId);
    if (!player || player.role !== 'plant') return;

    player.resources += amount;

    server.to(player.id).emit('updateResources', player.resources);
  }

  // 🌊 Siguiente oleada
  nextWave(server: Server, roomId: string) {
    const game = this.getGame(roomId);
    if (!game) return;

    game.wave++;

    if (game.wave > game.maxWaves) {
      game.status = 'finished';
      server.to(roomId).emit('gameOver', { message: 'Juego terminado' });
      return;
    }

    // Zombies ganan recursos por oleada
    for (const player of game.players) {
      if (player.role === 'zombie') {
        player.resources += 500 + game.wave * 100;
      }
    }

    server.to(roomId).emit('nextWave', {
      wave: game.wave,
      players: game.players,
    });
  }

  // 📌 Obtener partida
  getGame(roomId: string) {
    return this.games.get(roomId);
  }

  // 🟦 Estado público para enviar al frontend
  getPublicGameState(roomId: string) {
    const game = this.getGame(roomId);
    if (!game) return null;

    return {
      roomId: game.roomId,
      wave: game.wave,
      maxWaves: game.maxWaves,
      status: game.status,
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        resources: p.resources,
      })),
      board: game.board,
    };
  }

  // ❌ Jugador desconectado
  removePlayer(clientId: string) {
    const room = this.roomsService.findRoomByPlayer(clientId);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== clientId);

    if (room.players.length === 0) {
      this.roomsService.deleteRoom(room.id);
      this.games.delete(room.id);
      console.log(`Sala ${room.id} eliminada (vacía).`);
    }
  }
}
