// src/rooms/rooms.service.ts
import { Injectable } from '@nestjs/common';
import { Room, Player, Color } from './rooms.interface';

@Injectable()
export class RoomsService {
  private rooms: Room[] = [];
  private readonly colors: Color[] = ['red', 'blue', 'green', 'yellow'];

  getRoom(roomId: string): Room | undefined {
    return this.rooms.find((r) => r.id === roomId);
  }

  listRooms(): Room[] {
    return this.rooms;
  }

  createRoom(roomId: string, creator: { id: string; name: string }): Room {
    const color: Color = 'red'; // El creador siempre inicia con rojo (o el primero disponible)
    const room: Room = {
      id: roomId,
      players: [{ id: creator.id, name: creator.name, color }],
      status: 'waiting',
    };
    this.rooms.push(room);
    return room;
  }

  joinRoom(roomId: string, playerData: { id: string; name: string }): Room | null {
    const room = this.getRoom(roomId);
    if (!room) return null;
    if (room.players.length >= 4) return null;
    if (room.players.find((p) => p.id === playerData.id)) return null;

    const used = new Set(room.players.map((p) => p.color));
    let color = this.colors.find((c) => !used.has(c));
    if (!color) color = this.colors[Math.floor(Math.random() * this.colors.length)];

    room.players.push({ id: playerData.id, name: playerData.name, color });
    room.status = room.players.length >= 2 ? 'ready' : 'waiting';
    return room;
  }

  // --- NUEVA FUNCIÓN PARA BOTS ---
  addBotToRoom(roomId: string): Room | null {
    const room = this.getRoom(roomId);
    if (!room) return null;
    if (room.players.length >= 4) return null;

    // Generar ID y Nombre de Bot
    const botId = `BOT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const botName = `Bot ${room.players.length + 1} 🤖`;

    const used = new Set(room.players.map((p) => p.color));
    let color = this.colors.find((c) => !used.has(c));
    if (!color) color = this.colors[0];

    room.players.push({ id: botId, name: botName, color });
    
    // Actualizar estado si ya hay suficientes jugadores (humanos o bots)
    room.status = room.players.length >= 2 ? 'ready' : 'waiting';
    
    return room;
  }

  removePlayerFromRoom(playerId: string) {
    const room = this.findRoomByPlayer(playerId);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== playerId);

    if (room.players.length === 0) {
      this.deleteRoom(room.id);
    } else if (room.players.length < 2) {
      room.status = 'waiting';
    } else {
      room.status = 'ready'; // Sigue ready si quedan bots suficientes
    }
  }

  findRoomByPlayer(playerId: string): Room | undefined {
    return this.rooms.find((r) => r.players.some((p) => p.id === playerId));
  }

  deleteRoom(roomId: string) {
    this.rooms = this.rooms.filter((r) => r.id !== roomId);
  }
}