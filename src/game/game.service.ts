import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';

interface PlayerState {
  id: string;
  name: string;
  role: 'plant' | 'zombie';
  resources: number; // soles o cerebros
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
  private games: GameState[] = [];

  constructor(private readonly roomsService: RoomsService) {}

  // 🧱 Crear nueva partida asociada a una sala
  createGame(roomId: string) {
    const room = this.roomsService.getRoom(roomId);
    if (!room) return null;

    const game: GameState = {
      roomId,
      players: [],
      board: {},
      status: 'waiting',
      wave: 0,
      maxWaves: 5,
    };

    this.games.push(game);
    return game;
  }

  // 🎮 Añadir jugador a la partida
  addPlayerToGame(roomId: string, player: PlayerState) {
    const game = this.getGame(roomId);
    if (!game) return;

    const exists = game.players.find((p) => p.id === player.id);
    if (!exists) game.players.push(player);
  }

  // 🔄 Asignar rol a un jugador (plant / zombie)
  setPlayerRole(roomId: string, playerId: string, role: 'plant' | 'zombie') {
    const game = this.getGame(roomId);
    if (!game) return;

    const existing = game.players.find((p) => p.id === playerId);
    if (existing) existing.role = role;
  }

  // 🚀 Iniciar el juego
  startGame(server: Server, roomId: string) {
    const game = this.getGame(roomId);
    if (!game) return;

    game.status = 'in-progress';
    game.wave = 1;

    // Inicializar recursos según el rol
    for (const player of game.players) {
      player.resources = player.role === 'plant' ? 50 : 1000;
    }

    // Emitir evento al frontend
    server.to(roomId).emit('gameStarted', {
      wave: game.wave,
      players: game.players,
      status: game.status,
    });
  }

  // 🌻 Colocar planta
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
    game.board[plantData.position] = { type: 'plant', ...plantData };

    server.to(roomId).emit('plantPlaced', { playerId, plantData, board: game.board });
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
    game.board[zombieData.position] = { type: 'zombie', ...zombieData };

    server.to(roomId).emit('zombiePlaced', { playerId, zombieData, board: game.board });
  }

  // ☀️ Recoger soles (jugador plantas)
  collectSun(server: Server, roomId: string, playerId: string, amount: number) {
    const game = this.getGame(roomId);
    if (!game) return;

    const player = game.players.find((p) => p.id === playerId);
    if (!player || player.role !== 'plant') return;

    player.resources += amount;
    server.to(player.id).emit('updateResources', player.resources);
  }

  // 🌊 Pasar a la siguiente horda
  nextWave(server: Server, roomId: string) {
    const game = this.getGame(roomId);
    if (!game) return;

    game.wave++;
    if (game.wave > game.maxWaves) {
      game.status = 'finished';
      server.to(roomId).emit('gameOver', { message: 'Juego terminado' });
      return;
    }

    // Recompensa al jugador zombie con más cerebros
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

  // 🧩 Obtener partida por ID
  getGame(roomId: string): GameState | undefined {
    return this.games.find((g) => g.roomId === roomId);
  }

  // 🔥 Eliminar jugador desconectado
  removePlayer(clientId: string) {
    const room = this.roomsService.findRoomByPlayer(clientId);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== clientId);

    if (room.players.length === 0) {
      this.roomsService.deleteRoom(room.id);
      this.games = this.games.filter((g) => g.roomId !== room.id);
      console.log(`Sala ${room.id} eliminada (vacía).`);
    }
  }
}
