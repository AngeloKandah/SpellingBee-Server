import express from 'express';
import http from 'http';
import getWords from './wordGenerator.js';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';
import { MongoClient } from 'mongodb';

const DB = 'spellingbee';
const COLLECTION = 'sessions';
const mongoClient = new MongoClient('mongodb://localhost:27017', {
  useUnifiedTopology: true,
});
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
  },
});
await mongoClient.connect();
try {
  await mongoClient.db(DB).createCollection(COLLECTION);
} catch (e) {
  // collection already exists
}
const mongoCollection = mongoClient.db(DB).collection(COLLECTION);

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerName }, callback) =>
    createRoom(socket, playerName, callback)
  );

  socket.on('joiningRoom', ({ roomCode, playerName }, callback) =>
    joiningRoom(socket, roomCode, playerName, callback)
  );

  socket.on('endTurn', ({ attempt, currentWord }, callback) =>
    endTurn(socket, attempt, currentWord, callback)
  );

  socket.on('nextTurn', () => nextTurn(socket));

  socket.on('disconnecting', () => disconnecting(socket));
});

server.listen(5000, () => {
  console.log('listening on port 5000');
});

async function createRoom(socket, playerName, callback) {
  const roomCode = nanoid();
  socket.join(roomCode);
  const words = await getWords();
  await mongoCollection.insertOne({
    room: roomCode,
    players: [{ id: socket.id, playerName, lives: 3 }],
    turn: 0,
    wordList: words,
  });
  callback({ currentWord: words[0], roomCode });
}

async function joiningRoom(socket, roomCode, playerName, callback) {
  const session = await mongoCollection.findOne({
    room: roomCode,
  });
  if (!session) {
    callback(
      'This is not a valid room, please create one or check the code you entered'
    );
    return;
  }
  if (!playerName) {
    // Get a random name because their name is empty string
  }
  socket.join(roomCode);
  await mongoCollection.updateOne(
    { room: roomCode },
    {
      $push: {
        players: { id: socket.id, playerName, lives: 3 },
      },
    }
  );
  const { players: playersBeforeNew, turn, wordList } = session;
  const players = [
    ...Object.values(playersBeforeNew),
    { id: socket.id, playerName },
  ];
  io.to(roomCode).emit('playerListUpdate', players);
  const currentWord = wordList[turn];
  callback(currentWord);
}

async function endTurn(socket, attempt, currentWord, callback) {
  const isCorrect = attempt === currentWord;
  if (!isCorrect) {
    await decrementLives(socket);
  }
  await nextTurn(socket);
  callback(isCorrect);
}

async function nextTurn(socket) {
  const roomCode = [...socket.rooms][1];
  const {
    value: { turn: turnBeforeInc, wordList, players },
  } = await mongoCollection.findOneAndUpdate(
    { room: roomCode },
    { $inc: { turn: 1 } }
  );
  const turn = turnBeforeInc + 1;
  const currentPlayerId = players[turn % players.length].id;
  const currentWord = wordList[turn];
  io.to(roomCode).emit('nextWord', { currentWord, currentPlayerId });
}

async function decrementLives(socket) {
  const roomCode = [...socket.rooms][1];
  const {
    value: { players },
  } = await mongoCollection.findOneAndUpdate(
    { room: roomCode, 'players.id': socket.id },
    { $inc: { 'players.$.lives': -1 } }
  );
  const { lives } = players.find(({ id }) => id === socket.id);
  if (!(lives - 1)) {
    const { isSessionOver, remainingPlayers } = await removePlayer(socket, roomCode);
    // Maybe dont remove them from bottom, just display they have 0 lives, X over name maybe?
    // Leave this until ^ implemented
    io.to(roomCode).emit('playerListUpdate', remainingPlayers);
  }
  // Emit to room session is over once everyone has lost their lives
}

async function disconnecting(socket) {
  const roomCode = [...socket.rooms][1];
  const { isSessionOver, remainingPlayers } = await removePlayer(
    socket,
    roomCode
  );
  io.to(roomCode).emit('playerListUpdate', remainingPlayers);
  if (isSessionOver) {
    removeSession(roomCode);
  }
}

async function removePlayer(socket, roomCode) {
  const { value } = await mongoCollection.findOneAndUpdate(
    { room: roomCode },
    { $pull: { players: { id: socket.id } } }
  );
  const { players = {} } = value || [];
  const remainingPlayers = Object.values(players).filter(
    ({ id }) => id != socket.id
  );
  const isSessionOver = remainingPlayers.length === 0;
  return { isSessionOver, remainingPlayers };
}

async function removeSession(roomCode) {
  await mongoCollection.deleteOne({
    room: roomCode,
    players: { $exists: true, $size: 0 },
  });
}
