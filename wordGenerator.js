import * as fs from 'fs/promises';

export default async function getWords(numberOfWords) {
  const indicesOfWords = [...new Array(100)].map(() =>
    Math.round(Math.random() * 178187)
  );
  const file = await fs.readFile('words.json');
  const words = indicesOfWords.map((index) => JSON.parse(file)[index]);
  return words;
}
