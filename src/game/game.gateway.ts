// src/game/game.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';
import { GameService } from './game.service';

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly roomsService: RoomsService,
    private readonly gameService: GameService,
  ) {}

  handleConnection(client: Socket) {
    console.log(`Jugador conectado: ${client.id}`);
    client.emit('connected', client.id);
  }

  handleDisconnect(client: Socket) {
    console.log(`Jugador desconectado: ${client.id}`);
    const room = this.roomsService.findRoomByPlayer(client.id);

    this.gameService.removePlayer(client.id);
    // Nota: removePlayerFromRoom a veces elimina la sala si queda vacía
    this.roomsService.removePlayerFromRoom(client.id);

    if (room) {
      this.server.to(room.id).emit('roomUpdated', room);
      // Actualizar estado del juego si está en curso
      const state = this.gameService.getPublicGameState(room.id);
      if (state) this.server.to(room.id).emit('game_state', state);
    }
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerName: string },
  ) {
    const room = this.roomsService.createRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
    });

    client.join(data.roomId);
    this.gameService.createGame(data.roomId);
    this.server.to(data.roomId).emit('roomCreated', room);
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerName: string },
  ) {
    const room = this.roomsService.getRoom(data.roomId);

    // Intenta unir al jugador
    const joinedRoom = this.roomsService.joinRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
    });

    // Si joinRoom devuelve null, puede ser porque la sala está llena O porque el jugador YA ESTÁ dentro.
    // Verificamos si el jugador ya está en la sala para permitir reconexión
    const isAlreadyIn = room?.players.find((p) => p.id === client.id);

    if (!joinedRoom && !isAlreadyIn) {
      client.emit(
        'errorJoining',
        'No se pudo unir a la sala (no existe o está llena).',
      );
      return;
    }

    // SOLUCIÓN ERROR 1: Definir una sala activa segura
    const activeRoom = joinedRoom || room;

    if (!activeRoom) {
      client.emit('errorJoining', 'Error inesperado: Sala no encontrada.');
      return;
    }

    client.join(data.roomId);
    this.server.to(data.roomId).emit('roomJoined', activeRoom);

    // Sincronizar estado del juego (IMPORTANTE PARA EVITAR PANTALLA GRIS)
    const game = this.gameService.getGame(data.roomId);
    if (game) {
      // Si el juego ya existe, aseguramos que el jugador esté en la lista del juego
      // Usamos activeRoom que ya sabemos que no es undefined
      const p = activeRoom.players.find((pl) => pl.id === client.id);
      if (p) {
        this.gameService.addPlayerToGame(data.roomId, {
          id: p.id,
          name: p.name,
          color: p.color,
        });
      }

      // Emitir estado actual a TODOS (o al menos al que entró)
      const state = this.gameService.getPublicGameState(data.roomId);
      if (state) {
        this.server.to(data.roomId).emit('game_state', state);
      }
    }

    if (activeRoom.players.length >= 2 && activeRoom.status !== 'playing') {
      activeRoom.status = 'ready';
      this.server.to(data.roomId).emit('roomUpdated', activeRoom);
    }
  }

  @SubscribeMessage('startGame')
  handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const room = this.roomsService.getRoom(data.roomId);
    if (!room) return;

    // Asegurar que exista el objeto Game
    let game = this.gameService.getGame(data.roomId);
    if (!game) game = this.gameService.createGame(data.roomId);

    room.status = 'playing';
    this.server.to(data.roomId).emit('roomUpdated', room);

    // Iniciar lógica interna del juego
    this.gameService.startGame(this.server, data.roomId);

    // Emitir eventos de inicio
    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server
        .to(data.roomId)
        .emit('gameInitialized', { roomId: data.roomId });
      // Importante: emitir el estado inicial para pintar los colores
      this.server.to(data.roomId).emit('game_state', state);
    }
  }

  @SubscribeMessage('rollDice')
  handleRollDice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const game = this.gameService.getGame(data.roomId);
    if (!game || game.status !== 'in-progress') return;

    const current = game.players[game.turnIndex];
    if (current?.id !== client.id) {
      client.emit('error', 'No es tu turno.');
      return;
    }

    if (game.dice !== null) {
      client.emit('error', 'Ya tiraste el dado. Mueve una ficha.');
      return;
    }

    const value = this.gameService.rollDice(data.roomId);
    this.server.to(data.roomId).emit('diceRolled', { value });

    // --- CORRECCIÓN CLAVE: Verificar si hay movimientos posibles ---
    // Si no hay movimientos posibles, esperar un momento y pasar turno automáticamente
    if (!this.gameService.hasAnyValidMove(data.roomId)) {
      setTimeout(() => {
        this.gameService.advanceTurn(data.roomId);
        const newState = this.gameService.getPublicGameState(data.roomId);
        
        // SOLUCIÓN ERROR 2: Verificar que newState existe antes de usarlo
        if (newState) {
          this.server
            .to(data.roomId)
            .emit(
              'message',
              `Jugador ${current.name} no tiene movimientos. Pasa turno.`,
            );
          this.server.to(data.roomId).emit('game_state', newState);
          this.server
            .to(data.roomId)
            .emit('turnChanged', { turnIndex: newState.turnIndex });
        }
      }, 1500); // Esperar 1.5s para que vean el dado
    } else {
      // Si hay movimientos, solo actualizamos estado esperando el 'movePiece'
      const state = this.gameService.getPublicGameState(data.roomId);
      if (state) {
          this.server.to(data.roomId).emit('game_state', state);
      }
    }
  }

  @SubscribeMessage('movePiece')
  handleMovePiece(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roomId: string; playerId: string; pieceIndex: number },
  ) {
    const game = this.gameService.getGame(data.roomId);
    if (!game || game.status !== 'in-progress') return;

    const current = game.players[game.turnIndex];
    if (current.id !== client.id) return;

    const moved = this.gameService.movePiece(
      data.roomId,
      data.playerId,
      data.pieceIndex,
    );

    if (!moved) {
      client.emit('error', 'Movimiento inválido.');
      return;
    }

    // Si sacó 6, repite turno (opcional, reglas de ludo).
    // Asumiremos regla simple: siempre pasa turno tras mover (para probar)
    this.gameService.advanceTurn(data.roomId);

    this.server.to(data.roomId).emit('pieceMoved', data);

    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server.to(data.roomId).emit('game_state', state);
      this.server
        .to(data.roomId)
        .emit('turnChanged', { turnIndex: state.turnIndex });
    }
  }
}