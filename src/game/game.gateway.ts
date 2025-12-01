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

  // 🟢 Cuando un jugador se conecta
  handleConnection(client: Socket) {
    console.log(`Jugador conectado: ${client.id}`);
    client.emit('connected', client.id);
  }

  // 🔴 Cuando un jugador se desconecta
  handleDisconnect(client: Socket) {
    console.log(`Jugador desconectado: ${client.id}`);
    this.gameService.removePlayer(client.id);
  }

  // 🟦 Crear sala (host = plantas)
  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerName: string },
  ) {
    const room = this.roomsService.createRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
      side: 'plant',
    });

    client.join(data.roomId);
    console.log(`🌿 Sala creada: ${data.roomId}`);

    this.server.to(data.roomId).emit('roomCreated', room);
  }

  // 🟩 Unirse a sala (jugador = zombies)
  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; playerName: string },
  ) {
    const room = this.roomsService.joinRoom(data.roomId, {
      id: client.id,
      name: data.playerName,
      side: 'zombie',
    });

    if (room) {
      client.join(data.roomId);
      console.log(`🧟 ${data.playerName} se unió a ${data.roomId}`);

      this.server.to(data.roomId).emit('roomJoined', room);
    } else {
      client.emit('errorJoining', 'No se pudo unir a la sala.');
    }
  }

  // 🔥 Iniciar partida
  @SubscribeMessage('startGame')
  handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    console.log(`🎮 Iniciando juego en sala ${data.roomId}`);

    let game = this.gameService.getGame(data.roomId);
    if (!game) {
      game = this.gameService.createGame(data.roomId);
      console.log(`📌 Partida creada para sala ${data.roomId}`);
    }

    const room = this.roomsService.getRoom(data.roomId);

    if (room) {
      for (const player of room.players) {
        this.gameService.addPlayerToGame(data.roomId, {
          id: player.id,
          name: player.name,
          role: player.side,
          resources: 0,
        });
      }
    }

    this.gameService.startGame(this.server, data.roomId);

    console.log(`🔥 Juego iniciado en sala ${data.roomId}`);
  }

  // 🌱 Colocar planta
  @SubscribeMessage('placePlant')
  handlePlacePlant(
    @MessageBody()
    data: { roomId: string; playerId: string; plantData: any },
  ) {
    this.gameService.placePlant(
      this.server,
      data.roomId,
      data.playerId,
      data.plantData,
    );
  }

  // 🧟 Colocar zombie
  @SubscribeMessage('placeZombie')
  handlePlaceZombie(
    @MessageBody()
    data: { roomId: string; playerId: string; zombieData: any },
  ) {
    this.gameService.placeZombie(
      this.server,
      data.roomId,
      data.playerId,
      data.zombieData,
    );
  }
}
