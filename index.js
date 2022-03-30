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
  socket.on('createRoom', (callback) => createRoom(socket, callback));

  socket.on('joiningRoom', ({ roomCode }, callback) =>
    joiningRoom(socket, roomCode, callback)
  );

  socket.on('endTurn', ({ attempt, word }, callback) =>
    endTurn(socket, attempt, word, callback)
  );

  socket.on('nextTurn', () => nextTurn(socket));

  socket.on('disconnecting', () => disconnecting(socket));
});

server.listen(5000, () => {
  console.log('listening on port 5000');
});

async function createRoom(socket, callback) {
  const roomCode = nanoid();
  socket.join(roomCode);
  const words = await getWords();
  await mongoCollection.insertOne({
    room: roomCode,
    members: [socket.id],
    turn: 0,
    wordList: words,
  });
  callback({ word: words[0], roomCode });
}

async function joiningRoom(socket, roomCode, callback) {
  const session = await mongoCollection.findOne({
    room: roomCode,
  });
  if (!session) {
    // Add 'no room made with this ID'
    callback(
      'This is not a valid room, please create one or check the code you entered'
    );
    return;
  }
  socket.join(roomCode);
  await mongoCollection.updateOne(
    { room: roomCode },
    { $push: { members: socket.id } }
  );
  const { members, turn, wordList } = session;
  const players = [...members, socket.id];
  io.to(roomCode).emit('newPlayer', players);
  callback({ word: wordList[turn % (members.length + 1)] });
}

async function endTurn(socket, attempt, word, callback) {
  await nextTurn(socket);
  callback(attempt === word);
}

async function nextTurn(socket) {
  const roomCode = [...socket.rooms][1];
  const clients = [...io.sockets.adapter.rooms.get(roomCode)];
  const {
    value: { turn: turnBeforeInc, wordList },
  } = await mongoCollection.findOneAndUpdate(
    { room: roomCode },
    { $inc: { turn: 1 } }
  );
  const turn = turnBeforeInc + 1;
  // This gets the person's turn;
  const idOfWhosTurn = clients[turn % clients.length];
  const word = wordList[turn];
  io.to(roomCode).emit('nextWord', { word, idOfWhosTurn });
}

async function disconnecting(socket) {
  const roomCode = [...socket.rooms][1];
  const isSessionOver = await removePlayer(socket, roomCode);
  if (isSessionOver) {
    removeSession(roomCode);
  }
}

async function removePlayer(socket, roomCode) {
  const { value } = await mongoCollection.findOneAndUpdate(
    { room: roomCode },
    { $pull: { members: socket.id } }
  );
  const { members = [] } = value || {};
  return members.length === 1;
}

async function removeSession(roomCode) {
  await mongoCollection.deleteOne({
    room: roomCode,
    members: { $exists: true, $size: 0 },
  });
}
