/**
 * Pilote LAN pour ampoules Tuya (Calex Smart et compatibles), protocoles 3.2 a 3.5.
 *
 * Ce que fait ce module : traduire le contrat metier LightDriver en datapoints
 * Tuya, sur une connexion locale persistante — sans jamais passer par le cloud.
 *
 * LE CHOIX NON EVIDENT, ET LA RAISON D'ETRE DE CE FICHIER : sur ces ampoules,
 * l'intensite lumineuse n'a pas un seul reglage mais deux, selon le mode courant
 * (DP 21). En mode 'white' elle vit dans le DP 22 ; en mode 'colour' elle vit
 * dans la troisieme composante du DP 24, et le DP 22 devient inerte. Un pilote
 * naif ecrit toujours le DP 22 et donne l'impression que « la molette ne fait
 * rien » des que l'utilisateur a choisi une couleur. C'est le defaut le plus
 * repandu des integrations Tuya. Ici, setBrightness route vers le bon datapoint.
 *
 * Corollaire assume : demander une luminosite en mode 'scene' ou 'music' fait
 * SORTIR du mode, vers 'white'. C'est deliberé — une commande qui ne produit
 * aucun effet visible est un pire defaut qu'une commande qui change de mode.
 *
 * Invariants a preserver :
 *   - aucun numero de DP ne doit fuir hors de ce fichier ;
 *   - toute ecriture est suivie d'une relecture de l'etat par l'appelant s'il a
 *     besoin d'afficher la verite (l'ampoule est seule maitresse de son etat) ;
 *   - les erreurs remontent CLASSEES (voir errors.ts), jamais avalees ;
 *   - le device Tuya a TOUJOURS un ecouteur 'error'. Sans lui, Node relance
 *     l'evenement en exception non capturee : un ECONNRESET pendant une
 *     coupure wifi tuait le processus du plugin, et toutes les touches
 *     cessaient de repondre sans qu'aucun message ne l'explique.
 *
 * Usage canonique :
 *   const bulb = await TuyaLanDriver.connect({ id, key, ip });
 *   await bulb.togglePower();
 *   await bulb.nudgeBrightness(+10);
 *   await bulb.close();
 */
import TuyAPI from 'tuyapi';
import type { Hsv, LightCapabilities, LightDriver, LightMode, LightState } from './types.js';
import { LightError, asLightError } from './errors.ts';

/** Datapoints du profil Tuya « dj » (source lumineuse), schema v2. */
const DP = {
  power: '20',
  mode: '21',
  brightness: '22',
  temperature: '23',
  color: '24',
} as const;

/** Bornes natives Tuya : la luminosite ne descend pas sous 10/1000. */
const TUYA_MIN = 10;
const TUYA_MAX = 1000;

/** Plage de blanc des ampoules Calex CCT. Ajuster par modele si besoin. */
const KELVIN_MIN = 2700;
const KELVIN_MAX = 6500;

export type TuyaLanConfig = {
  readonly id: string;
  readonly key: string;
  /** Adresse LAN. Omise, elle est decouverte par diffusion UDP (plus lent). */
  readonly ip?: string;
  /**
   * Version du protocole annoncee par l'ampoule, par exemple "3.4".
   *
   * Omise, on retombe sur 3.3, de tres loin la plus repandue. La supposer etait
   * la seule chose qui limitait le plugin a une partie du catalogue Tuya : les
   * modeles vendus depuis 2022 parlent souvent 3.4 ou 3.5, et la decouverte
   * reseau lisait deja cette valeur sans que personne ne la conserve.
   */
  readonly version?: string;
};

/** Version retenue quand l'ampoule n'a pas eu l'occasion de l'annoncer. */
export const DEFAULT_PROTOCOL = '3.3';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 0-100 % vers l'echelle Tuya 10-1000. */
export const pctToTuya = (pct: number) => clamp(Math.round(pct * 10), TUYA_MIN, TUYA_MAX);
/** Echelle Tuya 10-1000 vers 1-100 %. */
export const tuyaToPct = (raw: number) => clamp(Math.round(raw / 10), 1, 100);

/** Encode une couleur au format DP 24 : teinte, saturation et valeur sur 4 hex chacune. */
export function encodeColor({ h, s, v }: Hsv): string {
  const hex = (n: number, max: number) => clamp(Math.round(n), 0, max).toString(16).padStart(4, '0');
  return hex(h, 360) + hex(s * 10, TUYA_MAX) + hex(v * 10, TUYA_MAX);
}

/** Decode le DP 24. Renvoie null si la chaine n'a pas la forme attendue. */
export function decodeColor(raw: unknown): Hsv | null {
  if (typeof raw !== 'string' || !/^[0-9a-f]{12}$/i.test(raw)) return null;
  return {
    h: parseInt(raw.slice(0, 4), 16),
    s: clamp(Math.round(parseInt(raw.slice(4, 8), 16) / 10), 0, 100),
    v: clamp(Math.round(parseInt(raw.slice(8, 12), 16) / 10), 0, 100),
  };
}

export const kelvinToTuya = (k: number) =>
  clamp(Math.round(((k - KELVIN_MIN) / (KELVIN_MAX - KELVIN_MIN)) * TUYA_MAX), 0, TUYA_MAX);
export const tuyaToKelvin = (raw: number) =>
  Math.round(KELVIN_MIN + (clamp(raw, 0, TUYA_MAX) / TUYA_MAX) * (KELVIN_MAX - KELVIN_MIN));

/**
 * Dernier evenement 'error' capture, en attente d'etre attribue a une operation.
 *
 * Un evenement ne peut pas etre "leve" : il arrive hors de toute pile d'appel.
 * On le retient donc ici pour que l'operation qui echouera juste apres puisse
 * en tirer sa cause, au lieu de ne rapporter qu'un delai depasse.
 */
type TransportSink = { last: Error | null };

/**
 * Retient le verdict le plus precis entre le rejet et l'evenement 'error'.
 *
 * Quand un socket tombe, tuyapi rejette souvent sur un delai depasse alors que
 * la cause reelle — la coupure — est arrivee par l'evenement une fraction de
 * seconde plus tot. On ne prefere l'evenement QUE si le rejet ne dit rien :
 * preferer toujours l'un ou toujours l'autre donnerait tantot un diagnostic
 * plus vague, tantot un diagnostic perime par une panne precedente.
 */
function pickCause(rejection: unknown, sink: TransportSink): LightError {
  const direct = asLightError(rejection);
  if (direct.failure !== 'unknown' || sink.last === null) return direct;
  return asLightError(sink.last);
}

export class TuyaLanDriver implements LightDriver {
  // Optimiste par defaut : si la table de datapoints est illisible, mieux vaut
  // laisser l'utilisateur essayer que lui interdire une action qui marcherait.
  private caps: LightCapabilities = {
    supportsColor: true,
    supportsTemperature: true,
    temperatureRangeK: [KELVIN_MIN, KELVIN_MAX],
  };

  get capabilities(): LightCapabilities {
    return this.caps;
  }

  /**
   * Deduit ce que l'ampoule sait faire de sa table de datapoints.
   *
   * Une ampoule blanche seule n'expose pas le DP 24 (couleur), et parfois pas le
   * DP 23 (temperature). Sans ce releve, l'action correspondante echouait sans
   * un mot et l'utilisateur concluait que le plugin est casse, alors que c'est
   * son materiel qui ne sait pas.
   */
  private async detectCapabilities(): Promise<void> {
    try {
      const dps = await this.readDps();
      this.caps = {
        supportsColor: DP.color in dps,
        supportsTemperature: DP.temperature in dps,
        temperatureRangeK: [KELVIN_MIN, KELVIN_MAX],
      };
    } catch {
      // Table illisible : on conserve l'hypothese optimiste ci-dessus.
    }
  }

  private readonly device: TuyAPI;
  private readonly sink: TransportSink;

  // Champ assigne explicitement plutot qu'en propriete de parametre : cette
  // syntaxe TypeScript exige une transformation, la ou le reste du fichier se
  // contente d'un effacement de types. Node peut ainsi executer ce module tel
  // quel, sans etape de build — ce dont les tests profitent directement.
  private constructor(device: TuyAPI, sink: TransportSink) {
    this.device = device;
    this.sink = sink;
  }

  /**
   * Execute une operation de transport et qualifie son echec.
   *
   * Vide la sonde AVANT d'agir : un incident vieux de dix minutes, laisse la
   * par une commande precedente, ferait accuser le reseau alors que l'echec du
   * jour vient d'ailleurs.
   */
  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    this.sink.last = null;
    try {
      return await operation();
    } catch (error) {
      throw pickCause(error, this.sink);
    }
  }

  /**
   * Ecrit un ou plusieurs datapoints, l'echec qualifie.
   *
   * Point de passage UNIQUE des ecritures : c'est ce qui garantit qu'aucune
   * commande ne peut echouer sans que sa cause soit nommee.
   */
  private async write(payload: Parameters<TuyAPI['set']>[0]): Promise<void> {
    await this.guard(() => this.device.set(payload));
  }

  /**
   * Ouvre une connexion locale persistante. Echoue franchement si l'ampoule est injoignable.
   *
   * L'ecouteur 'error' est pose AVANT la moindre operation et n'est jamais
   * retire : c'est lui qui empeche le plugin de mourir sur un incident reseau
   * (voir l'invariant en tete de fichier).
   */
  static async connect(config: TuyaLanConfig): Promise<TuyaLanDriver> {
    const device = new TuyAPI({
      id: config.id,
      key: config.key,
      ip: config.ip,
      version: config.version ?? DEFAULT_PROTOCOL,
      issueRefreshOnConnect: true,
    });

    const sink: TransportSink = { last: null };
    device.on('error', (cause: Error) => { sink.last = cause; });

    try {
      if (!config.ip) await device.find();
      await device.connect();
    } catch (error) {
      device.disconnect();
      throw pickCause(error, sink);
    }

    const driver = new TuyaLanDriver(device, sink);
    await driver.detectCapabilities();
    return driver;
  }

  /**
   * Lit la table brute des datapoints.
   *
   * tuyapi type le retour de get() comme une union — une valeur isolee OU l'objet
   * complet — selon les options passees. Avec `schema: true` c'est toujours
   * l'objet, mais le type ne peut pas le savoir. On verifie donc plutot que de
   * forcer le typage : une ampoule qui repond autre chose est une anomalie qui
   * doit se voir immediatement, pas se propager en `undefined` silencieux.
   */
  private async readDps(): Promise<Record<string, unknown>> {
    const status = await this.guard(() => this.device.get({ schema: true }));

    // UNE CHAINE la ou un objet est attendu : en protocole 3.3, tuyapi rend la
    // charge utile TELLE QUELLE quand elle ne se dechiffre pas. Il ne leve rien,
    // n'emet aucun evenement 'error', et ne pose donc aucune des signatures que
    // classify() sait lire. Or le socket est etabli et l'ampoule a repondu : la
    // cle locale est la seule variable qui reste. Sans ce cas, une cle regeneree
    // depuis l'appli Calex — le scenario le plus courant — s'afficherait
    // « Erreur » au lieu de « Cle refusee », et l'utilisateur n'aurait aucune
    // raison d'aller la ressaisir.
    if (typeof status === 'string') {
      throw new LightError('badKey', new Error('charge utile indechiffrable : cle locale refusee'));
    }
    if (typeof status !== 'object' || status === null || !('dps' in status)) {
      throw new Error('Reponse inattendue de l ampoule : table de datapoints absente');
    }
    return (status as { dps: Record<string, unknown> }).dps;
  }

  async read(): Promise<LightState> {
    const dps = await this.readDps();
    const mode = (dps[DP.mode] ?? 'white') as LightMode;
    const color = decodeColor(dps[DP.color]);
    return {
      on: dps[DP.power] === true,
      mode,
      // En mode couleur, l'intensite percue est la composante V, pas le DP 22.
      brightness: mode === 'colour' && color ? color.v : tuyaToPct(Number(dps[DP.brightness] ?? TUYA_MAX)),
      temperatureK: dps[DP.temperature] === undefined ? null : tuyaToKelvin(Number(dps[DP.temperature])),
      color: mode === 'colour' ? color : null,
    };
  }

  async setPower(on: boolean): Promise<void> {
    await this.write({ dps: Number(DP.power), set: on });
  }

  async togglePower(): Promise<boolean> {
    const { on } = await this.read();
    await this.setPower(!on);
    return !on;
  }

  /**
   * Regle l'intensite dans le mode courant.
   *
   * Route vers la composante V du DP 24 en mode couleur, vers le DP 22 sinon.
   * Depuis 'scene' ou 'music', bascule volontairement en 'white' (voir l'en-tete).
   */
  async setBrightness(percent: number): Promise<void> {
    const pct = clamp(Math.round(percent), 1, 100);
    const state = await this.read();

    if (state.mode === 'colour' && state.color) {
      await this.write({ dps: Number(DP.color), set: encodeColor({ ...state.color, v: pct }) });
      return;
    }
    if (state.mode === 'scene' || state.mode === 'music') {
      await this.write({
        multiple: true,
        data: { [DP.mode]: 'white', [DP.brightness]: pctToTuya(pct) },
      });
      return;
    }
    await this.write({ dps: Number(DP.brightness), set: pctToTuya(pct) });
  }

  async nudgeBrightness(delta: number): Promise<number> {
    const { brightness } = await this.read();
    const next = clamp(brightness + delta, 1, 100);
    await this.setBrightness(next);
    return next;
  }

  async setTemperature(kelvin: number): Promise<void> {
    await this.write({
      multiple: true,
      data: { [DP.mode]: 'white', [DP.temperature]: kelvinToTuya(kelvin) },
    });
  }

  async setColor(color: Hsv): Promise<void> {
    await this.write({
      multiple: true,
      data: { [DP.mode]: 'colour', [DP.color]: encodeColor(color) },
    });
  }

  async close(): Promise<void> {
    // L'ecouteur 'error' n'est deliberement PAS retire : detruire le socket
    // peut encore emettre un ECONNRESET au tick suivant, et il n'y aurait
    // alors plus personne pour l'absorber — soit exactement la panne que cet
    // ecouteur existe pour empecher. Il part avec le device, a la collecte.
    this.device.disconnect();
  }
}
