// src/rooms/rooms.interface.ts

export interface Player {
  id: string;
  name: string;
  side: 'plant' | 'zombie'; // rol del jugador
}

export interface Room {
  id: string;
  players: Player[];
  // 🔹 Agregamos 'ready' como estado intermedio
  status: 'waiting' | 'ready' | 'playing' | 'finished';
  board: any; // aquí luego puedes guardar las posiciones del juego
}
