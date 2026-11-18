import Ajv from "ajv";
import { entries, type Operation } from "./index";
const ajv = new Ajv({
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
const schemas = new Map(
  entries.map(([id, meta]) => [id, ajv.compile(meta.input)]),
);
export function validInput(operation: Operation, input: unknown) {
  return schemas.get(operation)!(input);
}
