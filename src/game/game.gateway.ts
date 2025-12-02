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

  // 🟢 Conexión establecida
  handleConnection(client: Socket) {
    console.log(`Jugador conectado: ${client.id}`);
    client.emit('connected', client.id);
  }

  // 🔴 Jugador desconectado
  handleDisconnect(client: Socket) {
    console.log(`Jugador desconectado: ${client.id}`);
    this.gameService.removePlayer(client.id);
  }

  // 🟦 Crear sala (primer jugador = plantas)
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

  // 🟩 Unirse a sala (segundo jugador = zombies)
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

    if (!room) {
      client.emit('errorJoining', 'No se pudo unir a la sala.');
      return;
    }

    client.join(data.roomId);
    console.log(`🧟 ${data.playerName} se unió a ${data.roomId}`);

    this.server.to(data.roomId).emit('roomJoined', room);
  }

  // 🎮 Handler del BOTÓN "JUGAR"
  @SubscribeMessage('startGame')
  handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string }
  ) {
    console.log(`▶️ startGame recibido para sala ${data.roomId}`);

    this.startGame(data.roomId);

    // 🔥 Evento que tu frontend ESPERA
    this.server.to(data.roomId).emit('gameInitialized');
  }

  // 🔥 LÓGICA PRIVADA PARA ARRANCAR EL JUEGO
  private startGame(roomId: string) {
    console.log(`🎮 Iniciando juego en sala ${roomId}`);

    let game = this.gameService.getGame(roomId);

    if (!game) {
      game = this.gameService.createGame(roomId);
      console.log(`📌 Partida creada para sala ${roomId}`);
    }

    const room = this.roomsService.getRoom(roomId);
    if (!room) return;

    // Registrar jugadores
    for (const player of room.players) {
      this.gameService.addPlayerToGame(roomId, {
        id: player.id,
        name: player.name,
        role: player.side,
        resources: 100,
      });
    }

    // Iniciar el estado real del game
    this.gameService.startGame(this.server, roomId);

    // Show internal "gameStarted"
    const gameState = this.gameService.getGame(roomId);
    this.server.to(roomId).emit('gameStarted', gameState);

    console.log(`🔥 Juego iniciado correctamente en sala ${roomId}`);
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

  // ➕ Siguiente ola
  @SubscribeMessage('nextWave')
  handleNextWave(@MessageBody() data: { roomId: string }) {
    this.gameService.nextWave(this.server, data.roomId);
  }
}
