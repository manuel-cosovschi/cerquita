import { describe, expect, it } from 'vitest';
import { countTerms } from './demand.service';

/** The shape the caller reads: term first, count second, sorted by count. */
const terms = (titles: string[]) =>
  countTerms(titles).map((entry) => `${entry.term}:${entry.count}`);

describe('countTerms', () => {
  it('reports a word only once it repeats across posts', () => {
    // One person wanting a guitar is not a market signal, it is one person.
    expect(terms(['Busco guitarra criolla'])).toEqual([]);
    expect(terms(['Busco guitarra criolla', 'Busco guitarra electrica'])).toEqual(['guitarra:2']);
  });

  it('counts a word once per post, however often the post repeats it', () => {
    const result = terms([
      'Bicicleta bicicleta bicicleta',
      'Busco bicicleta para el trabajo',
      'Vendo otra cosa',
    ]);

    // Two posts mention bikes, not four mentions.
    expect(result).toEqual(['bicicleta:2']);
  });

  it('strips the "busco" framing so the list names things, not phrasing', () => {
    const result = terms(['Busco heladera con freezer', 'Busco heladera chica']);

    expect(result).toEqual(['heladera:2']);
  });

  it('drops function words that repeat across any two Spanish sentences', () => {
    const result = terms([
      'Busco heladera para la cocina',
      'Busco lavarropas para el lavadero',
      'Busco microondas para casa',
    ]);

    // "para" appears in all three and names nothing anybody wants.
    expect(result).toEqual([]);
  });

  it('folds accents and case so one word is not counted as two', () => {
    expect(terms(['Busco Cámara de fotos', 'busco camara reflex'])).toEqual(['camara:2']);
  });

  it('orders by how many people asked', () => {
    const result = terms([
      'Busco bicicleta rodado 29',
      'Busco bicicleta de ruta',
      'Busco bicicleta fija',
      'Busco heladera con freezer',
      'Busco heladera chica',
    ]);

    expect(result).toEqual(['bicicleta:3', 'heladera:2']);
  });
});
