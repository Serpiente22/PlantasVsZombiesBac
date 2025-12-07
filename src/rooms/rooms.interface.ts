// src/rooms/rooms.interface.ts

export type Color = 'red' | 'blue' | 'green' | 'yellow';

export interface Player {
  id: string;
  name: string;
  color: Color; // color asignado automáticamente al entrar
}

export interface Room {
  id: string;
  players: Player[];
  // estados: waiting (menos de 2), ready (2-4 esperando inicio), playing, finished
  status: 'waiting' | 'ready' | 'playing' | 'finished';
  board?: any; // opcional, reservado para guardar datos si hace falta
}
