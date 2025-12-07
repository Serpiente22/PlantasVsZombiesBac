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
    const color = 'red'; // primer jugador siempre rojo
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

    const used = new Set(room.players.map(p => p.color));
    const color = this.colors.find(c => !used.has(c));
    if (!color) return null;

    room.players.push({
      id: playerData.id,
      name: playerData.name,
      color,
    });

    room.status = room.players.length >= 2 ? 'ready' : 'waiting';
    return room;
  }

  removePlayerFromRoom(playerId: string) {
    const room = this.findRoomByPlayer(playerId);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== playerId);

    if (room.players.length === 0) {
      this.deleteRoom(room.id);
    } else if (room.players.length < 2) {
      room.status = 'waiting';
    } else {
      room.status = 'ready';
    }
  }

  findRoomByPlayer(playerId: string): Room | undefined {
    return this.rooms.find(r => r.players.some(p => p.id === playerId));
  }

  deleteRoom(roomId: string) {
    this.rooms = this.rooms.filter(r => r.id !== roomId);
  }
}
