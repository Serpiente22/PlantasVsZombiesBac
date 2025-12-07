// src/rooms/rooms.service.ts

import { Injectable } from '@nestjs/common';
import { Room, Player, Color } from './rooms.interface';

@Injectable()
export class RoomsService {
  private rooms: Room[] = [];

  // orden fijo de colores
  private readonly colors: Color[] = ['red', 'blue', 'green', 'yellow'];

  // Buscar sala
  getRoom(roomId: string): Room | undefined {
    return this.rooms.find((r) => r.id === roomId);
  }

  listRooms(): Room[] {
    return this.rooms;
  }

  // Crear sala con el primer jugador (color asignado automaticamente)
  createRoom(roomId: string, creator: { id: string; name: string }): Room {
    const color = this.colors[0]; // rojo al crear
    const room: Room = {
      id: roomId,
      players: [{ id: creator.id, name: creator.name, color }],
      status: 'waiting',
      board: {},
    };
    this.rooms.push(room);
    return room;
  }

  // Unirse a sala: asigna siguiente color disponible, máximo 4 jugadores
  joinRoom(roomId: string, playerData: { id: string; name: string }): Room | null {
    const room = this.getRoom(roomId);
    if (!room) return null;
    if (room.players.length >= 4) return null;

    // encontrar primer color libre
    const used = new Set(room.players.map((p) => p.color));
    const color = this.colors.find((c) => !used.has(c));
    if (!color) return null; // ya hay 4 (seguridad)

    room.players.push({ id: playerData.id, name: playerData.name, color });
    // actualizar estado: si tiene >=2 se pone 'ready'
    if (room.players.length >= 2) room.status = 'ready';
    return room;
  }

  // Eliminar jugador de sala
  removePlayerFromRoom(playerId: string) {
    const room = this.findRoomByPlayer(playerId);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== playerId);

    if (room.players.length === 0) {
      // borrar sala
      this.deleteRoom(room.id);
    } else if (room.players.length < 2) {
      room.status = 'waiting';
    } else {
      room.status = 'ready';
    }
  }

  // Buscar sala donde está un jugador
  findRoomByPlayer(playerId: string): Room | undefined {
    return this.rooms.find((r) => r.players.some((p) => p.id === playerId));
  }

  // Borrar sala por id
  deleteRoom(roomId: string) {
    this.rooms = this.rooms.filter((r) => r.id !== roomId);
  }
}
