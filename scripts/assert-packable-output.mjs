import path from 'node:path';
import { assertSingleSelectedGeneration } from './pack-utils.mjs';

const packageDirectory = path.resolve(import.meta.dirname, '..');
const generationId = assertSingleSelectedGeneration(packageDirectory);
console.log(`Invest SDK pack guard selected generation ${generationId}.`);
