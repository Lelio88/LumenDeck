/**
 * Verifie le classement des pannes de lampe. Aucune ampoule, aucun reseau.
 *
 * Les messages testes ne sont pas inventes : ils sont recopies des sites qui les
 * levent dans tuyapi 7.x, avec le numero de ligne en commentaire. Un test ecrit
 * sur un message imagine donnerait toutes les garanties sauf la bonne — celle
 * que la chaine attendue est bien celle qui arrive.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LightError, asLightError, classify } from '../errors.ts';

/** Fabrique une erreur systeme, comme celles que Node pose sur un socket. */
function errnoError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

test('une cle locale erronee est reconnue, quelle que soit sa signature', () => {
  // Arrange : les trois facons dont tuyapi signale une cle qui ne dechiffre pas.
  const cases = [
    'Decrypt failed',                                              // lib/cipher.js:165
    'HMAC mismatch(keys): expected a1b2, was c3d4. 00112233',      // index.js:761
    'HMAC mismatch: expected 9f, was 2e. 0011',                    // lib/message-parser.js:219
    'CRC mismatch: expected 9f, was 2e. 0011',                     // lib/message-parser.js:226
  ];
  // Act + Assert
  for (const message of cases) {
    assert.equal(classify(new Error(message)), 'badKey', message);
  }
});

test('une ampoule injoignable est reconnue, message comme code systeme', () => {
  // Arrange
  const cases = [
    new Error('find() timed out. Is the device powered on and the ID or IP correct?'), // index.js:1117
    new Error('connection timed out'),                                                 // index.js:634
    new Error('Error from socket: read ECONNRESET'),                                   // index.js:688
    errnoError('connect ECONNREFUSED 192.168.1.42:6668', 'ECONNREFUSED'),
    errnoError('connect EHOSTUNREACH 192.168.1.42:6668', 'EHOSTUNREACH'),
  ];
  // Act + Assert
  for (const error of cases) {
    assert.equal(classify(error), 'unreachable', error.message);
  }
});

test('une ampoule qui ne repond plus se distingue d une ampoule absente', () => {
  // Arrange : l'ampoule a bien accepte la connexion, mais reste muette.
  const error = new Error('Timeout waiting for status response from device id: bf1234'); // index.js:460
  // Act + Assert : « unresponsive », surtout pas « unreachable » — le reseau va bien.
  assert.equal(classify(error), 'unresponsive', error.message);
});

test('une panne inconnue est classee sans lever d exception', () => {
  // Arrange : tuyapi emet parfois un Buffer brut plutot qu'une Error (index.js:655).
  const cases = [new Error('quelque chose d inedit'), Buffer.from('00ff', 'hex'), undefined, null];
  // Act + Assert
  for (const value of cases) {
    assert.equal(classify(value), 'unknown');
  }
});

test('LightError porte la cause classee et conserve l erreur d origine', () => {
  // Arrange
  const origine = new Error('Decrypt failed');
  // Act
  const erreur = asLightError(origine);
  // Assert
  assert.ok(erreur instanceof LightError);
  assert.equal(erreur.failure, 'badKey');
  assert.equal(erreur.cause, origine, 'la cause d origine doit rester atteignable');
});

test('asLightError n emballe pas deux fois', () => {
  // Arrange : une erreur deja classee, remontee au travers d une seconde couche.
  const premiere = asLightError(new Error('connection timed out'));
  // Act
  const seconde = asLightError(premiere);
  // Assert : sans quoi la cause d origine s enfouirait d un cran a chaque etage.
  assert.equal(seconde, premiere);
});
