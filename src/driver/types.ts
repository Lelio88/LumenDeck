/**
 * Contrat de pilotage d'une source lumineuse, independant du protocole.
 *
 * Ce que fait ce module : definir le vocabulaire metier (allumer, regler la
 * luminosite, choisir une couleur) que les actions Stream Deck manipulent, sans
 * qu'elles connaissent jamais Tuya, Zigbee ou Matter.
 *
 * Choix non evident : les grandeurs sont exprimees en POURCENTAGE (0-100) et en
 * KELVIN, pas dans les unites du transport. Tuya parle en 0-1000 et en teinte
 * 0-360 ; Zigbee parle en 0-254 et en mireds. Normaliser ici evite que chaque
 * action refasse la conversion — et que l'interface utilisateur affiche « 1000 »
 * la ou l'utilisateur attend « 100 % ».
 *
 * Invariant a preserver : un pilote ne doit JAMAIS exposer un identifiant de
 * datapoint, un numero de cluster ou un code fabricant au-dela de cette
 * frontiere. Le jour ou l'on ajoute un adaptateur Zigbee, seul le dossier
 * driver/ change.
 *
 * Usage canonique :
 *   const bulb = await TuyaLanDriver.connect(config);
 *   await bulb.setPower(true);
 *   await bulb.setBrightness(40);
 *   const state = await bulb.read();
 */

/** Mode d'eclairage courant. Determine quel reglage pilote reellement l'intensite. */
export type LightMode = 'white' | 'colour' | 'scene' | 'music';

/** Etat complet d'une lampe, en unites metier. */
export type LightState = {
  /** Allumee ou eteinte. */
  readonly on: boolean;
  /** Mode courant. En 'colour', la luminosite vit dans la couleur (voir driver Tuya). */
  readonly mode: LightMode;
  /** Intensite percue, 1-100 %. Toujours renseignee, quel que soit le mode. */
  readonly brightness: number;
  /** Temperature de blanc en kelvins, ou null si la lampe n'en a pas. */
  readonly temperatureK: number | null;
  /** Couleur courante, ou null si la lampe est en blanc. */
  readonly color: Hsv | null;
};

/** Couleur en teinte/saturation/valeur, unites d'affichage. */
export type Hsv = {
  /** Teinte, 0-360 degres. */
  readonly h: number;
  /** Saturation, 0-100 %. */
  readonly s: number;
  /** Valeur, 0-100 %. */
  readonly v: number;
};

/**
 * Operations que toute lampe doit savoir faire.
 *
 * Les implementations sont responsables de rendre ces operations coherentes
 * QUEL QUE SOIT le mode courant : appeler setBrightness ne doit jamais etre
 * un no-op silencieux sous pretexte que la lampe est en mode couleur.
 */
export interface LightDriver {
  /** Ce que cette lampe sait reellement faire. Releve a la connexion. */
  readonly capabilities: LightCapabilities;
  /** Lit l'etat courant. Doit refleter la lampe, pas un cache optimiste. */
  read(): Promise<LightState>;
  /** Allume ou eteint. */
  setPower(on: boolean): Promise<void>;
  /** Bascule l'etat d'allumage et renvoie le nouvel etat. */
  togglePower(): Promise<boolean>;
  /** Regle l'intensite percue, 1-100 %, dans le mode courant. */
  setBrightness(percent: number): Promise<void>;
  /** Ajoute un delta a l'intensite courante, borne a [1, 100]. */
  nudgeBrightness(delta: number): Promise<number>;
  /** Passe en blanc et regle la temperature, en kelvins. */
  setTemperature(kelvin: number): Promise<void>;
  /** Passe en couleur et applique la teinte demandee. */
  setColor(color: Hsv): Promise<void>;
  /** Libere la connexion. Idempotent. */
  close(): Promise<void>;
}

/** Bornes d'une lampe donnee, pour que l'interface n'offre pas l'impossible. */
export type LightCapabilities = {
  readonly supportsColor: boolean;
  readonly supportsTemperature: boolean;
  /** Plage de blanc reellement atteignable, en kelvins. */
  readonly temperatureRangeK: readonly [number, number];
};
