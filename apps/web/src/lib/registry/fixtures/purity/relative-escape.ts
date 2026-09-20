import { checkLogicPurity } from "../../purity";

// Fixture: a relative import that climbs out of the tool's own folder.
export const check = checkLogicPurity;
