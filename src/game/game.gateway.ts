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
    this.gameService.removePlayer(client.id);

    const room = this.roomsService.findRoomByPlayer(client.id);
    if (room) {
      this.server.to(room.id).emit('roomUpdated', room);
      // también reenviamos estado del juego por si hace falta
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
    const room = this.roomsService.joinRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
    });

    if (!room) {
      client.emit('errorJoining', 'No se pudo unir a la sala (no existe, llena o ya estás dentro).');
      return;
    }

    client.join(data.roomId);

    // sincronizar game (si existe) con la room
    const game = this.gameService.getGame(data.roomId);
    if (game) {
      const p = room.players.find((pl) => pl.id === client.id);
      if (p) {
        this.gameService.addPlayerToGame(data.roomId, {
          id: p.id,
          name: p.name,
          color: (p as any).color,
        });
        // emitir estado actualizado del juego
        const state = this.gameService.getPublicGameState(data.roomId);
        if (state) this.server.to(data.roomId).emit('game_state', state);
      }
    }

    this.server.to(data.roomId).emit('roomJoined', room);

    if (room.players.length >= 2) {
      room.status = 'ready';
      this.server.to(data.roomId).emit('roomUpdated', room);
    }
  }

  @SubscribeMessage('startGame')
  handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const room = this.roomsService.getRoom(data.roomId);
    if (!room) {
      client.emit('error', 'Sala no encontrada');
      return;
    }

    let game = this.gameService.getGame(data.roomId);
    if (!game) {
      game = this.gameService.createGame(data.roomId);
      if (!game) {
        client.emit('error', 'No se pudo crear la partida');
        return;
      }
    }

    // limpiar y volver a agregar jugadores (asegura orden consistente)
    game.players = [];
    for (const pl of room.players) {
      this.gameService.addPlayerToGame(data.roomId, {
        id: pl.id,
        name: pl.name,
        color: (pl as any).color,
      });
    }

    this.gameService.startGame(this.server, data.roomId);

    const state = this.gameService.getPublicGameState(data.roomId);
    this.server.to(data.roomId).emit('gameInitialized', { roomId: data.roomId });
    if (state) {
      this.server.to(data.roomId).emit('game_state', state);
      this.server.to(data.roomId).emit('turnChanged', { turnIndex: state.turnIndex });
    }
  }

  @SubscribeMessage('rollDice')
  handleRollDice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    const game = this.gameService.getGame(data.roomId);
    if (!game || game.status !== 'in-progress') {
      client.emit('error', 'No se puede tirar el dado (partida no iniciada).');
      return;
    }

    // sólo el jugador cuyo turno es puede tirar
    const current = game.players[game.turnIndex];
    if (current?.id !== client.id) {
      client.emit('error', 'No es tu turno para tirar el dado.');
      return;
    }

    const value = this.gameService.rollDice(data.roomId);
    if (value === null) {
      client.emit('error', 'No se pudo tirar el dado');
      return;
    }

    // Emitimos dado y estado actualizado
    this.server.to(data.roomId).emit('diceRolled', { value });

    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server.to(data.roomId).emit('game_state', state);
      // no cambiamos turno aquí — turno cambia al mover pieza (regla estándar)
      this.server.to(data.roomId).emit('turnChanged', { turnIndex: state.turnIndex });
    }
  }

  @SubscribeMessage('movePiece')
  handleMovePiece(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerId: string; pieceIndex: number },
  ) {
    const game = this.gameService.getGame(data.roomId);
    if (!game || game.status !== 'in-progress') {
      client.emit('error', 'Partida no iniciada o no válida.');
      return;
    }

    // Sólo jugador dueño de la ficha (y además el que tiene el turno) puede mover
    const current = game.players[game.turnIndex];
    if (!current) {
      client.emit('error', 'Turno inválido.');
      return;
    }
    if (current.id !== client.id) {
      client.emit('error', 'No es tu turno para mover.');
      return;
    }

    const moved = this.gameService.movePiece(
      data.roomId,
      data.playerId,
      data.pieceIndex,
    );

    if (!moved) {
      client.emit('error', 'Movimiento inválido (quizá no salió 6 para sacar ficha o no hay dado).');
      return;
    }

    // Avanzar turno sólo si la regla local lo requiere (en este backend siempre avanza)
    this.gameService.advanceTurn(data.roomId);

    // emitir movimiento y estado actualizado
    this.server.to(data.roomId).emit('pieceMoved', data);

    const state = this.gameService.getPublicGameState(data.roomId);
    if (state) {
      this.server.to(data.roomId).emit('game_state', state);
      this.server.to(data.roomId).emit('turnChanged', { turnIndex: state.turnIndex });
    }
  }
}
