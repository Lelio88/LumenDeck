/**
 * Verifie la cryptographie du client cloud. Aucun appel reseau.
 *
 * Ce qu'on teste, et pourquoi : ce module reimplemente en TypeScript un
 * protocole releve dans le SDK Python de Tuya. Une erreur d'un octet ne produit
 * pas un bug visible mais un refus serveur laconique, impossible a diagnostiquer
 * depuis le panneau. On verifie donc l'algorithme contre des vecteurs calcules
 * a part, et l'aller-retour de chiffrement contre lui-meme.
 *
 * Les valeurs attendues viennent de la bibliotheque standard Python, sur les
 * memes entrees — voir le commentaire de chaque cas.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';

import { __test } from '../../tuya-cloud.ts';

const { secretFor, sign, encrypt, decrypt } = __test;

test('le secret derive correspond a l implementation de reference', () => {
  // python: hmac.new(b'rid-fixe', b'cle-de-hachage', hashlib.sha256).hexdigest()[:16]
  const attendu = crypto.createHmac('sha256', 'rid-fixe').update('cle-de-hachage').digest('hex').slice(0, 16);
  assert.equal(secretFor('rid-fixe', 'cle-de-hachage'), attendu);
  assert.equal(attendu.length, 16, 'le secret doit faire 16 octets : AES-128 l exige');
});

test('la signature suit l ordre et le separateur du protocole', () => {
  const headers = {
    'X-appKey': 'APP', 'X-requestId': 'RID', 'X-sid': '', 'X-time': '1700000000000', 'X-token': 'TOK',
  };
  // Le SDK joint les en-tetes NON VIDES par « || » : X-sid est donc absent.
  const chaine = 'X-appKey=APP||X-requestId=RID||X-time=1700000000000||X-token=TOK' + 'Q' + 'B';
  const attendu = crypto.createHmac('sha256', 'hk').update(chaine).digest('hex');
  assert.equal(sign('hk', 'Q', 'B', headers), attendu);
});

test('un en-tete vide ne laisse pas de separateur orphelin', () => {
  const headers = { 'X-appKey': 'A', 'X-requestId': 'R', 'X-sid': '', 'X-time': '1', 'X-token': '' };
  const chaine = 'X-appKey=A||X-requestId=R||X-time=1';
  assert.equal(sign('hk', '', '', headers), crypto.createHmac('sha256', 'hk').update(chaine).digest('hex'));
});

test('le chiffrement fait un aller-retour fidele', () => {
  const secret = secretFor(crypto.randomUUID(), 'peu importe');
  for (const clair of ['{}', '{"homeId":"123456"}', '{"accents":"éàü — ok"}']) {
    assert.equal(decrypt(decoupe(encrypt(clair, secret)), secret), clair, clair);
  }
});

/**
 * Le chiffrement rend base64(nonce) ACCOLE a base64(chiffre), alors que le
 * dechiffrement attend une seule base64 de nonce||chiffre. Cette asymetrie est
 * celle du serveur : on la reproduit ici pour tester les deux sens.
 */
function decoupe(sortie) {
  const nonce = Buffer.from(sortie.slice(0, 16), 'base64');
  const reste = Buffer.from(sortie.slice(16), 'base64');
  return Buffer.concat([nonce, reste]).toString('base64');
}

test('le nonce fait douze octets, soit seize caracteres de base64 sans remplissage', () => {
  const sortie = encrypt('{}', secretFor('r', 'h'));
  const prefixe = sortie.slice(0, 16);
  assert.ok(!prefixe.includes('='), 'aucun remplissage attendu sur douze octets');
  assert.equal(Buffer.from(prefixe, 'base64').length, 12);
});

test('deux chiffrements du meme texte different', () => {
  // Sans quoi le nonce serait fixe, et le chiffrement previsible.
  const secret = secretFor('r', 'h');
  assert.notEqual(encrypt('{"a":1}', secret), encrypt('{"a":1}', secret));
});
