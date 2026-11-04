import { describe, expect, it } from 'vitest';
import {
  createFormulaEngine,
  findCircularReferences,
  formatWithCode,
  parseFormula,
  serialFromIso,
  serialFromParts,
  tokenize,
} from '../src/formula/index.js';
import { book, calc } from './helpers.js';

const err = (code: string) => ({ error: code });

describe('tokenizer', () => {
  it('reads references, ranges, whole columns/rows and quoted sheets', () => {
    const tokens = tokenize("SUM($A$1:B2, C:C, 2:5, 'Estimativa 2'!A1, Resumo!$D3, valor_hora)");
    const refs = tokens.filter((t) => t.type === 'ref').map((t) => [t.ref!.kind, t.ref!.sheet ?? '']);
    expect(refs).toEqual([
      ['area', ''],
      ['cols', ''],
      ['rows', ''],
      ['cell', 'Estimativa 2'],
      ['cell', 'Resumo'],
    ]);
    expect(tokens.find((t) => t.type === 'name')?.ident).toBe('VALOR_HORA');
    const abs = tokens[2]!.ref!;
    expect(abs.a).toEqual({ col: 0, row: 0, colAbs: true, rowAbs: true });
    expect(abs.b).toEqual({ col: 1, row: 1, colAbs: false, rowAbs: false });
  });

  it('distinguishes functions, names, booleans and error literals', () => {
    const types = tokenize('LOG10(1)+TRUE+#N/A+R1C1+A1').map((t) => t.type);
    expect(types).toEqual([
      'func',
      'lparen',
      'number',
      'rparen',
      'op',
      'bool',
      'op',
      'error',
      'op',
      'name',
      'op',
      'ref',
    ]);
  });

  it('rejects malformed input with a position', () => {
    expect(() => tokenize('"abc')).toThrow(/closing quote/);
    expect(() => parseFormula('SUM(1,')).toThrow();
    expect(() => parseFormula('1+')).toThrow();
    expect(() => parseFormula('{1,2}')).toThrow(/Array constants/);
  });
});

describe('operators', () => {
  it('follows Excel precedence and coercion', () => {
    expect(calc('-2^2')).toBe(4);
    expect(calc('2^3^2')).toBe(64);
    expect(calc('1+2*3')).toBe(7);
    expect(calc('50%*10')).toBe(5);
    expect(calc('0.1+0.2=0.3')).toBe(true);
    expect(calc('"a"&1&TRUE')).toBe('a1TRUE');
    expect(calc('"10"+5')).toBe(15);
    expect(calc('"abc"+1')).toEqual(err('#VALUE!'));
    expect(calc('1/0')).toEqual(err('#DIV/0!'));
    expect(calc('"B"<"a"')).toBe(false);
    expect(calc('1<"a"')).toBe(true);
    expect(calc('A1', {})).toBe(0);
    expect(calc('A1=""', {})).toBe(true);
    expect(calc('#N/A+1')).toEqual(err('#N/A'));
  });
});

describe('functions', () => {
  const data = {
    A1: 'Dev',
    A2: 'QA',
    A3: 'Dev',
    A4: 'PM',
    B1: 10,
    B2: 20,
    B3: 30,
    B4: 'x',
    C1: 1,
    C2: 2,
    C3: 3,
  };

  it('aggregates', () => {
    expect(calc('SUM(B1:B4)', data)).toBe(60);
    expect(calc('SUM(B:B)', data)).toBe(60);
    expect(calc('SUM(B1:B4,5,"2")', data)).toBe(67);
    expect(calc('AVERAGE(B1:B4)', data)).toBe(20);
    expect(calc('AVERAGE(D1:D4)', data)).toEqual(err('#DIV/0!'));
    expect(calc('MIN(B1:B4)', data)).toBe(10);
    expect(calc('MAX(B1:B4)', data)).toBe(30);
    expect(calc('COUNT(B1:B4)', data)).toBe(3);
    expect(calc('COUNTA(A1:B4)', data)).toBe(8);
  });

  it('conditional aggregates with criteria and wildcards', () => {
    expect(calc('SUMIF(A1:A4,"Dev",B1:B4)', data)).toBe(40);
    expect(calc('SUMIF(B1:B4,">15")', data)).toBe(50);
    expect(calc('SUMIF(A:A,"d*",B:B)', data)).toBe(40);
    expect(calc('COUNTIF(A1:A4,"<>Dev")', data)).toBe(2);
    expect(calc('COUNTIF(A1:A5,"")', data)).toBe(1);
    expect(calc('COUNTIF(B1:B4,">=20")', data)).toBe(2);
    expect(calc('COUNTIF(A1:A4,"?A")', data)).toBe(1);
    expect(calc('SUMIFS(B1:B4,A1:A4,"Dev",C1:C4,">1")', data)).toBe(30);
    expect(calc('COUNTIFS(A1:A4,"Dev",C1:C4,">=1")', data)).toBe(2);
    expect(calc('SUMIFS(B1:B4,A1:A3,"Dev")', data)).toEqual(err('#VALUE!'));
  });

  it('rounds half away from zero without binary artifacts', () => {
    expect(calc('ROUND(1.005,2)')).toBe(1.01);
    expect(calc('ROUND(-2.5,0)')).toBe(-3);
    expect(calc('ROUND(1234.5,-2)')).toBe(1200);
    expect(calc('ROUNDUP(3.21,1)')).toBe(3.3);
    expect(calc('ROUNDDOWN(-3.29,1)')).toBe(-3.2);
  });

  it('logical functions', () => {
    expect(calc('IF(1>2,"a","b")')).toBe('b');
    expect(calc('IF(FALSE,1)')).toBe(false);
    expect(calc('IF(TRUE,,1)')).toBe(0);
    expect(calc('IFS(1>2,"a",2>1,"b")')).toBe('b');
    expect(calc('IFS(1>2,"a")')).toEqual(err('#N/A'));
    expect(calc('AND(TRUE,1)')).toBe(true);
    expect(calc('OR(FALSE,0)')).toBe(false);
    expect(calc('AND(D1:D3)')).toEqual(err('#VALUE!'));
    expect(calc('NOT(0)')).toBe(true);
    expect(calc('IFERROR(1/0,"div")')).toBe('div');
    expect(calc('IF(1/0>1,1,2)')).toEqual(err('#DIV/0!'));
  });

  it('lookups', () => {
    const table = {
      A1: 1,
      B1: 'one',
      A2: 5,
      B2: 'five',
      A3: 10,
      B3: 'ten',
      D1: 'Ana',
      D2: 'bruno',
      E1: 100,
      E2: 200,
    };
    expect(calc('VLOOKUP(5,A1:B3,2,FALSE)', table)).toBe('five');
    expect(calc('VLOOKUP(7,A1:B3,2)', table)).toBe('five');
    expect(calc('VLOOKUP(0,A1:B3,2)', table)).toEqual(err('#N/A'));
    expect(calc('VLOOKUP(5,A1:B3,3,FALSE)', table)).toEqual(err('#REF!'));
    expect(calc('VLOOKUP("BRU*",D1:E2,2,FALSE)', table)).toBe(200);
    expect(calc('XLOOKUP("bruno",D1:D2,E1:E2)', table)).toBe(200);
    expect(calc('XLOOKUP("zé",D1:D2,E1:E2,"none")', table)).toBe('none');
    expect(calc('XLOOKUP("zé",D1:D2,E1:E2)', table)).toEqual(err('#N/A'));
    expect(calc('XLOOKUP(7,A1:A3,B1:B3,,-1)', table)).toBe('five');
    expect(calc('XLOOKUP(7,A1:A3,B1:B3,,1)', table)).toBe('ten');
    expect(calc('INDEX(A1:B3,3,2)', table)).toBe('ten');
    expect(calc('SUM(INDEX(A1:B3,0,1))', table)).toBe(16);
    expect(calc('INDEX(A1:B3,4,1)', table)).toEqual(err('#REF!'));
    expect(calc('MATCH(10,A1:A3,0)', table)).toBe(3);
    expect(calc('MATCH(6,A1:A3)', table)).toBe(2);
    expect(calc('INDEX(E1:E2,MATCH("ana",D1:D2,0))', table)).toBe(100);
  });

  it('text functions', () => {
    expect(calc('CONCAT("a",A1:B1,1)', { A1: 'x', B1: 2 })).toBe('ax21');
    expect(calc('LEFT("Hello",2)&RIGHT("Hello")')).toBe('Heo');
    expect(calc('LEN("ação")')).toBe(4);
    expect(calc('UPPER("ab")&LOWER("CD")')).toBe('ABcd');
    expect(calc('TRIM("  a   b ")')).toBe('a b');
    expect(calc('TEXT(1234.567,"#,##0.00")')).toBe('1,234.57');
    expect(calc('TEXT(0.256,"0.0%")')).toBe('25.6%');
    expect(calc('TEXT(DATE(2026,11,4),"dd/mm/yyyy")')).toBe('04/11/2026');
    expect(calc('TEXT(DATE(2026,11,4),"ddd, d mmm yy")')).toBe('Wed, 4 Nov 26');
    expect(calc('TEXT(-5,"0;(0)")')).toBe('(5)');
    expect(calc('TEXT(5,"000")')).toBe('005');
  });

  it('dates follow the Excel 1900 system', () => {
    expect(serialFromParts(1900, 1, 1)).toBe(1);
    expect(serialFromParts(1900, 2, 29)).toBe(60);
    expect(serialFromParts(1900, 3, 1)).toBe(61);
    expect(serialFromIso('2026-11-04')).toBe(46330);
    expect(calc('DATE(2026,14,1)')).toBe(serialFromIso('2027-02-01'));
    expect(calc('DATE(126,1,1)')).toBe(serialFromIso('2026-01-01'));
    expect(calc('EDATE(DATE(2026,1,31),1)')).toBe(serialFromIso('2026-02-28'));
    expect(calc('EOMONTH(DATE(2024,1,15),1)')).toBe(serialFromIso('2024-02-29'));
    expect(calc('WEEKDAY(DATE(2026,11,4))')).toBe(4);
    expect(calc('WEEKDAY(DATE(2026,11,4),2)')).toBe(3);
    expect(calc('WEEKDAY(1)')).toBe(1);
    expect(calc('NETWORKDAYS(DATE(2026,11,2),DATE(2026,11,13))')).toBe(10);
    expect(
      calc('NETWORKDAYS(DATE(2026,11,2),DATE(2026,11,13),A1)', { A1: serialFromIso('2026-11-11')! }),
    ).toBe(9);
    expect(calc('"2026-11-10"-DATE(2026,11,4)')).toBe(6);
  });

  it('TODAY reads the calculation date, never the clock', () => {
    expect(calc('TODAY()')).toEqual(err('#N/A'));
    expect(calc('TODAY()', {}, { settings: { calculationDate: '2026-11-04' } })).toBe(46330);
  });

  it('unknown functions and names evaluate to #NAME?', () => {
    expect(calc('FOO(1)')).toEqual(err('#NAME?'));
    expect(calc('missing_name')).toEqual(err('#NAME?'));
  });
});

describe('workbook evaluation', () => {
  it('resolves cross-sheet references and defined names', () => {
    const content = book(
      {
        Parametros: { A1: 'Valor hora', B1: 150 },
        'Estimativa 2': { A1: 10, B1: '=A1*valor_hora', C1: "='Estimativa 2'!B1+Parametros!B1" },
      },
      { names: [{ name: 'valor_hora', ref: 'Parametros!$B$1' }] },
    );
    expect(content.sheets[1]!.cells.B1!.v).toBe(1500);
    expect(content.sheets[1]!.cells.C1!.v).toBe(1650);
  });

  it('recalculates long dependency chains without recursion', () => {
    const cells: Record<string, string | number> = { A1: 1 };
    for (let row = 2; row <= 5000; row++) cells[`A${row}`] = `=A${row - 1}+1`;
    const content = book({ S: cells });
    expect(content.sheets[0]!.cells.A5000!.v).toBe(5000);
  });

  it('recalculates only dependents of changed cells', () => {
    const content = book({ S: { A1: 1, A2: '=A1*2', A3: '=A2+1', B1: '=5' } });
    content.sheets[0]!.cells.A1!.v = 10;
    const updates = createFormulaEngine().recalculate(content, [{ sheetId: 's1', address: 'A1' }]);
    expect(updates).toEqual([
      { sheetId: 's1', address: 'A2', value: 20 },
      { sheetId: 's1', address: 'A3', value: 21 },
    ]);
  });

  it('detects circular references', () => {
    const content = book({ S: { A1: '=B1', B1: '=A1', C1: '=C1+1', D1: '=SUM(D1:D2)' } });
    const cycles = findCircularReferences(content).map((group) => group.map((ref) => ref.address).sort());
    expect(cycles).toEqual(expect.arrayContaining([['A1', 'B1'], ['C1'], ['D1']]));
    expect(content.sheets[0]!.cells.A1!.v).toEqual(err('#REF!'));
  });
});

describe('validate', () => {
  const content = book(
    { Resumo: { A1: 1 }, 'Estimativa 2': {} },
    { names: [{ name: 'margem', ref: 'Resumo!$A$1' }] },
  );
  const engine = createFormulaEngine();
  const ctx = { content, sheetId: 's1' };

  it('accepts supported formulas', () => {
    expect(engine.validate("SUM('Estimativa 2'!A:A)*(1+margem)", ctx)).toEqual([]);
  });

  it('reports syntax errors, prohibited and unknown functions with hints', () => {
    expect(engine.validate('SUM(1,', ctx)[0]!.code).toBe('SYNTAX');
    const prohibited = engine.validate('WEBSERVICE("http://x")', ctx)[0]!;
    expect(prohibited.code).toBe('PROHIBITED_FUNCTION');
    const unknown = engine.validate('SUMPRODUCT(A1:A2)', ctx)[0]!;
    expect(unknown.code).toBe('UNKNOWN_FUNCTION');
    expect(unknown.hint).toMatch(/SUMIFS/);
    expect(engine.validate('SUMM(A1)', ctx)[0]!.hint).toMatch(/SUM/);
  });

  it('checks arity, sheets, names and bounds', () => {
    expect(engine.validate('ROUND(1,2,3)', ctx)[0]!.code).toBe('ARGUMENT_COUNT');
    expect(engine.validate('Nope!A1', ctx)[0]!.code).toBe('UNKNOWN_SHEET');
    expect(engine.validate('taxa*2', ctx)[0]!.code).toBe('UNKNOWN_NAME');
    expect(engine.validate('TODAY', ctx)[0]!.hint).toMatch(/TODAY\(\)/);
    expect(engine.validate('A100001', ctx)[0]!.code).toBe('OUT_OF_BOUNDS');
  });

  it('detects a circular reference for a cell', () => {
    expect(engine.validate('A1+1', { ...ctx, address: 'A1' })[0]!.code).toBe('CIRCULAR');
    expect(engine.validate('A1+1', { ...ctx, address: 'B1' })).toEqual([]);
  });

  it('formats TEXT codes with sections', () => {
    expect(formatWithCode(0, '0;-0;"zero"')).toBe('zero');
    expect(formatWithCode('abc', '0;0;0;"<"@">"')).toBe('<abc>');
    expect(formatWithCode(1234567, '#,##0,"k"')).toBe('1,235k');
    expect(formatWithCode(12345.678, '0.00E+00')).toBe('1.23E+04');
    expect(formatWithCode(0.5, 'h:mm AM/PM')).toBe('12:00 PM');
  });
});
