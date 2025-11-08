// src/rooms/rooms.service.ts

import { Injectable } from '@nestjs/common';
import { Room, Player } from './rooms.interface';

@Injectable()
export class RoomsService {
  private rooms: Room[] = [];

  // 🏠 Crear nueva sala
  createRoom(roomId: string, creator: Player): Room {
    const room: Room = {
      id: roomId,
      players: [creator],
      status: 'waiting',
      board: {},
    };
    this.rooms.push(room);
    return room;
  }

  // 🚪 Unirse a una sala existente
  joinRoom(roomId: string, player: Player): Room | null {
    const room = this.rooms.find((r) => r.id === roomId);
    if (room && room.players.length < 2) {
      room.players.push(player);
      // Cuando ya hay 2 jugadores, la sala está lista para iniciar
      if (room.players.length === 2) {
        room.status = 'ready';
      }
      return room;
    }
    return null;
  }

  // 🔍 Obtener una sala específica
  getRoom(roomId: string): Room | undefined {
    return this.rooms.find((r) => r.id === roomId);
  }

  // 📋 Listar todas las salas
  listRooms(): Room[] {
    return this.rooms;
  }

  // 🔎 Buscar en qué sala está un jugador
  findRoomByPlayer(playerId: string): Room | undefined {
    return this.rooms.find((room) =>
      room.players.some((p) => p.id === playerId),
    );
  }

  // ❌ Eliminar una sala (por id)
  deleteRoom(roomId: string) {
    this.rooms = this.rooms.filter((r) => r.id !== roomId);
  }
}
