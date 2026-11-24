import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameSimilarity, nameKey, scorePatients, SUGGEST_THRESHOLD } from '../api/src/lib/matching.js';

const close = [
  ['BENALI MOHAMED', 'BEN ALI MOHAMMED'],
  ['Mohamed Benali', 'BENALI^MHAMED'],
  ['ABDELKADER HADJ', 'Abd El Kader Hadj'],
  ['Saïda Bouchareb', 'SAIDA BOUCHAREB'],
  ['Youcef Khelifi', 'Youssef Khelifi'],
];
const far = [
  ['BENALI MOHAMED', 'SAADI FATIMA'],
  ['Amine Djebbar', 'Karim Mansouri'],
];

test('transliteration variants are close', () => {
  for (const [a, b] of close) assert.ok(nameSimilarity(a, b) >= 0.85, `${a} ~ ${b}: ${nameSimilarity(a, b)}`);
});

test('different people are far', () => {
  for (const [a, b] of far) assert.ok(nameSimilarity(a, b) < 0.75, `${a} vs ${b}: ${nameSimilarity(a, b)}`);
});

test('name key ignores order and vowels', () => {
  assert.equal(nameKey('MOHAMED BENALI'), nameKey('Benali Mohammed'));
});

test('birth date conflict blocks a suggestion', () => {
  const a = { full_name: 'BENALI MOHAMED', birth_date: '1980-01-01', sex: 'M' };
  const b = { full_name: 'BENALI MOHAMED', birth_date: '1955-06-12', sex: 'M' };
  assert.ok(scorePatients(a, b).score < SUGGEST_THRESHOLD);
});
