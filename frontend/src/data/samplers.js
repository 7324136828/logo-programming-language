import * as colors from './a_colors.js';
import * as design from './a_design.js';
import * as elephant from './a_elephant.js';
import * as fish from './a_fish.js';
import * as frog from './a_frog.js';
import * as horse from './a_horse.js';
import * as people from './a_people.js';
import * as spring from './a_spring.js';
import * as education from './p_edsamp.js';
import * as fun from './p_funsamp.js';

const sampler = (id, title, description, data, startupCommand, previewCommand, instructions, commands) => Object.freeze({
  id, name: id, title, description, ...data,
  hasGraphics: data.spritePatterns.length > 0,
  startupCommand, previewCommand, demoCommand: previewCommand,
  instructions, commands: Object.freeze(commands),
});

/** Original procedures and patterns are JavaScript text, bundled with the app. */
export const SAMPLERS = Object.freeze([
  sampler('A_COLORS', 'Color laboratory', 'Mix primary colors with moving sprites.', colors,
    'PRINT [ ]', 'COLORS',
    'Run COLORS. Press R, B, or Y twice to mix colors; Q ends the activity.', ['COLORS', 'HELP']),
  sampler('A_DESIGN', 'Shape designer', 'Create and move your own sprite designs.', design,
    'HELP', 'GRID 20',
    'Run GRID with a shape number from 15 through 25. Run LISTEN and use arrow keys to move; Q ends the activity.', ['GRID 20', 'LISTEN', 'HELP']),
  sampler('A_ELEPHANT', 'Elephant bath', 'An elephant plays with a spray of water.', elephant,
    'HELP', 'ELEPHANT',
    'Run ELEPHANT. Use Stop or Escape to interrupt the continuing water animation.', ['ELEPHANT', 'HELP']),
  sampler('A_FISH', 'Underwater', 'A swimming fish leaves a trail of bubbles.', fish,
    'HELP', 'FISH',
    'Run FISH. Use Stop or Escape to interrupt the swimming animation.', ['FISH', 'HELP']),
  sampler('A_FROG', 'Frog pond', 'Flies, lily pads, and a hungry frog.', frog,
    'HELP', 'FROG',
    'Run FROG. Use Stop or Escape to interrupt. FREEZE pauses sprite movement; THAW resumes it.', ['FROG', 'POND', 'HELP']),
  sampler('A_HORSE', 'Carousel', 'A horse circles a colorful carousel.', horse,
    'HELP', 'HORSE',
    'Run HORSE. Use Stop or Escape to interrupt the carousel animation.', ['HORSE', 'HELP']),
  sampler('A_PEOPLE', 'People studio', 'Assemble and color a figure one part at a time.', people,
    'ARROW.COLOR.DIRECTION', 'PEOPLE',
    'Run PEOPLE. Arrow keys move the part. R/B/Y/W/O/G/P change its color; A selects the next part; Q ends the activity.', ['PEOPLE', 'HELP']),
  sampler('A_SPRING', 'Spring garden', 'Rain gives way to sunshine and growing flowers.', spring,
    'HELP', 'SPRING',
    'Run SPRING and watch the season unfold. Use Stop or Escape to interrupt.', ['SPRING', 'HELP']),
  sampler('P_EDSAMP', 'Learning lab', 'Keyboard drawing, painting, and a target game.', education,
    '', 'LINE',
    'Run LINE or PAINT. F/B move, L/R turn, P lowers the pen, N lifts it. In PAINT, S changes pen colors and C changes background. Q ends. TARGET reads commands such as F 40 as a line.', ['LINE', 'PAINT', 'TARGET', 'HELP']),
  sampler('P_FUNSAMP', 'Turtle gallery', 'A house, a bear, recursive squares, and generative patterns.', fun,
    '', 'PICTURE',
    'Run PICTURE or BEAR for a completed drawing. SQUARES and PATTERNS keep drawing until Stop or Escape.', ['PICTURE', 'BEAR', 'SQUARES', 'PATTERNS', 'HELP']),
]);

export function findSampler(id) {
  const key = String(id).trim().toUpperCase();
  return SAMPLERS.find(item => item.id === key) ?? null;
}

/** Load definitions without launching a potentially endless interactive demo. */
export async function loadSampler(id, interpreter, { reset = true } = {}) {
  const item = findSampler(id);
  if (!item) throw new Error(`Unknown sampler: ${id}`);
  if (interpreter.running) throw new Error('Stop the current program before loading a sampler.');
  if (reset) interpreter.reset();
  interpreter.sprites.samplerId = item.id;
  interpreter.display.samplerId = item.id;
  for (let shape = 0; shape < item.spritePatterns.length / 32; shape++) {
    interpreter.sprites.setShapePattern(shape, item.spritePatterns.slice(shape * 32, shape * 32 + 32));
  }
  for (let character = 0; character < item.characterPatterns.length / 8; character++) {
    interpreter.display.setCharacterPattern(character, item.characterPatterns.slice(character * 8, character * 8 + 8));
  }
  const result = await interpreter.run(item.source);
  if (result.status !== 'ok') throw new Error(`${item.id} could not load: ${result.error || result.status}`);
  return item;
}
