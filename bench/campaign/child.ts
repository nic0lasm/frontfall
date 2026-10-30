import { playCampaignGame, type CampaignSetup } from "./game.ts";

/** One campaign game in a process of its own: the setup as JSON in, the report as one line of JSON out. */
const setup = JSON.parse(process.argv[2] ?? "{}") as CampaignSetup;
console.log(JSON.stringify(playCampaignGame(setup)));
