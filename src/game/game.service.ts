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
  // ESTADO NUEVO PARA PODERES
  multiplier: number; // 1 normal, 2 si tiene el poder x2
  bomb: { pieceIndex: number; timer: number } | null; // Si tiene bomba activa
}

interface GameState {
  roomId: string;
  players: LudoPlayerState[];
  turnIndex: number;
  dice: number | null;
  status: 'waiting' | 'in-progress' | 'finished';
  maxPlayers: number;
  winners: string[];
  // NUEVO
  totalTurns: number; // Contador global de turnos para spawnear poderes
  powerUps: Map<number, string>; // Posición -> Tipo ('mystery')
}

@Injectable()
export class GameService {
  private games: Map<string, GameState> = new Map();

  constructor(private readonly rooms: RoomsService) {}

  private readonly boardConfig = {
    green:  { start: 1,  turn: 51, finalPathStart: 100 },
    yellow: { start: 14, turn: 12, finalPathStart: 200 },
    blue:   { start: 27, turn: 25, finalPathStart: 300 },
    red:    { start: 40, turn: 38, finalPathStart: 400 },
  };

  createGame(roomId: string, maxPlayers = 4): GameState | undefined {
    const room = this.rooms.getRoom(roomId);
    if (!room) return;
    if (this.games.has(roomId)) return this.games.get(roomId);

    const game: GameState = {
      roomId,
      players: [],
      turnIndex: 0,
      dice: null,
      status: 'waiting',
      maxPlayers,
      winners: [],
      totalTurns: 0,
      powerUps: new Map(),
    };
    this.games.set(roomId, game);
    return game;
  }

  addPlayerToGame(roomId: string, data: { id: string; name: string; color: Color }) {
    const game = this.games.get(roomId);
    if (!game) return;
    if (!data.color) return;
    const existing = game.players.find((p) => p.id === data.id);
    if (existing) return;
    game.players.push({ ...data, pieces: [-1, -1, -1, -1], multiplier: 1, bomb: null });
  }

  startGame(server: Server, roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return;
    const room = this.rooms.getRoom(roomId);
    if (!room) return;

    const colorOrder: Color[] = ['green', 'yellow', 'blue', 'red'];
    game.players = room.players
      .map((p) => ({ 
          id: p.id, name: p.name, color: p.color, pieces: [-1, -1, -1, -1], 
          multiplier: 1, bomb: null 
      }))
      .sort((a, b) => colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color));

    game.status = 'in-progress';
    game.turnIndex = 0;
    game.dice = null;
    game.winners = [];
    game.totalTurns = 0;
    game.powerUps.clear();

    server.to(roomId).emit('gameStarted', this.getPublicGameState(roomId));
  }

  rollDice(roomId: string): number | null {
    const game = this.games.get(roomId);
    if (!game || game.status !== 'in-progress') return null;
    
    const player = game.players[game.turnIndex];
    
    let value = Math.floor(Math.random() * 6) + 1;
    
    // PODER: Multiplicador x2
    if (player.multiplier > 1) {
        value *= player.multiplier;
        player.multiplier = 1; // Consumir el poder
    }

    game.dice = value;
    return value;
  }

  // --- SPAWN DE PODERES ---
  spawnPowerUps(game: GameState) {
      // Generar 2 poderes en casillas aleatorias del camino principal (0-51)
      let added = 0;
      let attempts = 0;
      while (added < 2 && attempts < 20) {
          const pos = Math.floor(Math.random() * 52);
          
          // Verificar que no haya fichas ni otro poder ahí
          const isOccupied = game.players.some(p => p.pieces.includes(pos));
          const hasPower = game.powerUps.has(pos);
          
          if (!isOccupied && !hasPower) {
              game.powerUps.set(pos, 'mystery');
              added++;
          }
          attempts++;
      }
  }

  // --- APLICAR EFECTO DEL PODER ---
  applyPowerUp(game: GameState, player: LudoPlayerState, pieceIndex: number): { type: string, msg: string } | null {
      const powers = ['BOOST', 'DOUBLE_ROLL', 'X2_NEXT', 'FREE_EXIT', 'BOMB'];
      // Probabilidades: Bomb es raro, Boost es común
      const random = Math.random();
      let type = '';

      if (random < 0.3) type = 'BOOST'; // 30% Avanzar 4
      else if (random < 0.5) type = 'X2_NEXT'; // 20% x2
      else if (random < 0.7) type = 'DOUBLE_ROLL'; // 20% Repetir turno
      else if (random < 0.85) type = 'FREE_EXIT'; // 15% Sacar ficha
      else type = 'BOMB'; // 15% Bomba

      let msg = '';

      switch (type) {
          case 'BOOST':
              // Avanzar 4 casillas extra (recursivo simple, sin comer en el salto)
              // Calculamos la nueva posición manual para no complicar movePiece
              const currentPos = player.pieces[pieceIndex];
              let newPos = (currentPos + 4) % 52;
              if (currentPos < 52 && newPos < currentPos) { /* Dio la vuelta */ } 
              // Simplificación: mover 4 pasos si está en main track
              if (currentPos >= 0 && currentPos <= 51) {
                  player.pieces[pieceIndex] = newPos;
                  msg = '🚀 ¡Turbo! Avanzas 4 casillas.';
              } else {
                  msg = '🚀 ¡Turbo falló! (Zona segura).';
              }
              break;
          case 'DOUBLE_ROLL':
              game.dice = null; // Resetear dado para permitir tirar de nuevo
              // No avanzamos turno en el Gateway si sale esto
              msg = '🎲 ¡Tira otra vez!';
              break;
          case 'X2_NEXT':
              player.multiplier = 2;
              msg = '✖️2 ¡Tu próximo dado valdrá el doble!';
              break;
          case 'FREE_EXIT':
              const homePieceIdx = player.pieces.findIndex(p => p === -1);
              if (homePieceIdx !== -1) {
                  const config = this.boardConfig[player.color];
                  player.pieces[homePieceIdx] = config.start;
                  msg = '🔓 ¡Escape! Sacaste una ficha de casa.';
              } else {
                  msg = '🔓 ¡Escape fallido! No tienes fichas en casa.';
              }
              break;
          case 'BOMB':
              player.bomb = { pieceIndex, timer: 3 };
              msg = '💣 ¡TIENES LA BOMBA! Explota en 3 turnos.';
              break;
      }

      return { type, msg };
  }

  // --- LÓGICA DE EXPLOSIÓN ---
  checkBombExplosion(game: GameState, server: Server) {
      game.players.forEach(p => {
          if (p.bomb) {
              p.bomb.timer--;
              if (p.bomb.timer <= 0) {
                  // ¡BOOM!
                  const bombPos = p.pieces[p.bomb.pieceIndex];
                  const victims: string[] = [];

                  // Si la ficha ya llegó a meta o está en casa, la bomba se desactiva sola (suerte)
                  if (bombPos !== -1 && bombPos < 100) {
                      // Matar al portador
                      p.pieces[p.bomb.pieceIndex] = -1;
                      victims.push(p.name);

                      // Matar a los de alrededor (Radio 2 en el array circular 0-51)
                      game.players.forEach(other => {
                          other.pieces.forEach((pos, idx) => {
                              if (pos >= 0 && pos <= 51) {
                                  // Calcular distancia circular
                                  let dist = Math.abs(pos - bombPos);
                                  if (dist > 26) dist = 52 - dist; // Ajuste vuelta al mundo

                                  if (dist <= 2) { // Radio 2
                                      other.pieces[idx] = -1;
                                      if (!victims.includes(other.name)) victims.push(other.name);
                                  }
                              }
                          });
                      });
                      
                      server.to(game.roomId).emit('explosion', { pos: bombPos, victims });
                  }
                  
                  p.bomb = null; // Quitar bomba
              }
          }
      });
  }

  // ... (canMove, hasAnyValidMove, getAutomatedBotMove se mantienen igual)
  canMove(pos: number, dice: number, color: Color): boolean {
    if (pos === -1) return dice === 1 || dice === 6;
    const config = this.boardConfig[color];
    if (pos >= 100) {
      const stepsToGoal = (config.finalPathStart + 5) - pos;
      return dice <= stepsToGoal;
    }
    let distanceToTurn = config.turn - pos;
    if (distanceToTurn < 0) distanceToTurn += 52;
    if (dice > distanceToTurn) {
      const stepsIntoFinal = dice - distanceToTurn - 1;
      return stepsIntoFinal <= 5; 
    }
    return true;
  }

  hasAnyValidMove(roomId: string): boolean {
    const game = this.games.get(roomId);
    if (!game || game.dice === null) return false;
    const player = game.players[game.turnIndex];
    if (!player) return false;
    return player.pieces.some(pos => this.canMove(pos, game.dice!, player.color));
  }

  getAutomatedBotMove(roomId: string): number {
    // ... (Tu lógica de bot existente aquí, sin cambios)
    const game = this.games.get(roomId);
    if (!game || game.dice === null) return -1;
    const player = game.players[game.turnIndex];
    const validMoves = player.pieces
        .map((pos, index) => ({ index, pos, canMove: this.canMove(pos, game.dice!, player.color) }))
        .filter(m => m.canMove);
    if (validMoves.length === 0) return -1;
    for (const move of validMoves) {
        let futurePos = -1; 
        const config = this.boardConfig[player.color];
        if (move.pos === -1) futurePos = config.start;
        else futurePos = (move.pos + game.dice!) % 52; 
        if (futurePos >= 0 && futurePos <= 51) {
            const kills = game.players.some(p => p.id !== player.id && p.pieces.includes(futurePos));
            if (kills) return move.index; 
        }
    }
    const moveOut = validMoves.find(m => m.pos === -1);
    if (moveOut) return moveOut.index;
    return validMoves[Math.floor(Math.random() * validMoves.length)].index;
  }

  // --- MOVE PIECE CON PODERES ---
  movePiece(roomId: string, playerId: string, pieceIndex: number): { success: boolean; eatenPlayerName?: string | null; powerEffect?: any } {
    const game = this.games.get(roomId);
    if (!game) return { success: false };
    
    const player = game.players.find((p) => p.id === playerId);
    if (!player) return { success: false };
    
    const dice = game.dice ?? 0;
    if (dice <= 0) return { success: false };

    const currentPos = player.pieces[pieceIndex];
    if (!this.canMove(currentPos, dice, player.color)) return { success: false };

    let newPos = currentPos;
    const config = this.boardConfig[player.color];

    if (currentPos === -1) newPos = config.start;
    else if (currentPos >= 100) newPos = currentPos + dice;
    else {
      let distanceToTurn = config.turn - currentPos;
      if (distanceToTurn < 0) distanceToTurn += 52;
      if (dice > distanceToTurn) newPos = config.finalPathStart + (dice - distanceToTurn - 1);
      else newPos = (currentPos + dice) % 52;
    }
    
    player.pieces[pieceIndex] = newPos;
    game.dice = null;

    let eatenPlayerName: string | null = null;
    let powerEffect: any = null;

    if (newPos >= 0 && newPos <= 51) {
        // 1. Check Kill
        game.players.forEach(p => {
            if (p.id !== player.id) {
                p.pieces.forEach((enemyPos, idx) => {
                    if (enemyPos === newPos) {
                        p.pieces[idx] = -1; 
                        eatenPlayerName = p.name;
                    }
                });
            }
        });

        // 2. Check PowerUp
        if (game.powerUps.has(newPos)) {
            // Consumir poder
            game.powerUps.delete(newPos);
            powerEffect = this.applyPowerUp(game, player, pieceIndex);
        }
    }

    this.checkWinCondition(game, player);
    
    return { success: true, eatenPlayerName, powerEffect };
  }

  surrender(roomId: string, playerId: string): boolean {
      // ... (Lógica de surrender igual que antes)
      const game = this.games.get(roomId);
      if (!game) return false;
      const player = game.players.find(p => p.id === playerId);
      if (!player) return false;
      player.pieces = [-99, -99, -99, -99]; 
      if (game.players[game.turnIndex].id === playerId) this.advanceTurn(roomId);
      const activePlayers = game.players.filter(p => !p.pieces.every(pos => pos === -99));
      if (activePlayers.length < 2 && game.players.length > 1) {
          game.status = 'finished'; 
          game.winners.push(activePlayers[0]?.id);
      }
      return true;
  }

  checkWinCondition(game: GameState, player: LudoPlayerState) {
    const config = this.boardConfig[player.color];
    const goalPos = config.finalPathStart + 5;
    const allInGoal = player.pieces.every(pos => pos === goalPos);
    if (allInGoal && !game.winners.includes(player.id)) {
        game.winners.push(player.id);
        if (game.winners.length === game.players.length - 1 && game.players.length > 1) {
            game.status = 'finished';
        }
    }
  }

  advanceTurn(roomId: string) {
    const game = this.games.get(roomId);
    if (!game || game.status === 'finished') return;

    game.dice = null;
    game.totalTurns++; // Contar turno global

    // Cada 6 turnos, intentar spawnear poderes
    if (game.totalTurns % 6 === 0) {
        this.spawnPowerUps(game);
    }

    let nextIndex = game.turnIndex;
    let attempts = 0;
    do {
        nextIndex = (nextIndex + 1) % game.players.length;
        const nextPlayer = game.players[nextIndex];
        const hasSurrendered = nextPlayer.pieces.every(p => p === -99);
        
        if (!game.winners.includes(nextPlayer.id) && !hasSurrendered) {
            game.turnIndex = nextIndex;
            break;
        }
        attempts++;
    } while (attempts < game.players.length);
  }

  getPublicGameState(roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return null;

    // Convertir Map de poderes a Array para enviar por socket
    const powerUpsArray = Array.from(game.powerUps.entries()).map(([pos, type]) => ({ pos, type }));

    return {
      roomId: game.roomId,
      status: game.status,
      dice: game.dice,
      turnIndex: game.turnIndex,
      players: game.players,
      winners: game.winners,
      powerUps: powerUpsArray, // Enviar poderes al front
    };
  }

  getGame(roomId: string) { return this.games.get(roomId); }
  
  removePlayer(id: string) {
    // ... (Igual que antes)
    this.rooms.removePlayerFromRoom(id);
    for (const [roomId, game] of this.games.entries()) {
      if (game.status === 'waiting') {
           const index = game.players.findIndex(p => p.id === id);
           if (index !== -1) game.players.splice(index, 1);
      }
      if (game.players.length === 0) this.games.delete(roomId);
    }
  }
}