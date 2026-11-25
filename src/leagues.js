// Лиги и ставки по умолчанию. Админ может менять их в приложении —
// изменённая версия хранится в базе (таблица settings, ключ "leagues").
//
// Правило ставки: { role, cats, ages, price }
//   role — "Главный" / "Линейный" / "" (любое амплуа)
//   cats — категории через запятую ("1,2") или "" (любая)
//   ages — возрастная группа: "18", "15-17" или "" (любая / год не важен)
// Берётся первое подходящее правило. Если не подошло ни одно — цену вводят вручную.

export const CATEGORIES = ['ВК', '1', '2', '3', 'ЮС'];

const both = (main, line) => [
  { role: 'Главный', cats: '', ages: '', price: main },
  { role: 'Линейный', cats: '', ages: '', price: line },
];

const byCat = (role, ages, vk, c1, c23) => [
  { role, cats: 'ВК', ages, price: vk },
  { role, cats: '1', ages, price: c1 },
  { role, cats: '2,3', ages, price: c23 },
];

export const DEFAULT_LEAGUES = [
  {
    id: 'pr', name: 'Первенство России', year: true, active: true,
    rules: [
      ...byCat('Главный', '18', 4500, 4300, 4100),
      ...byCat('Линейный', '18', 2500, 2300, 2100),
      ...byCat('Главный', '15-17', 4200, 4000, 3800),
      ...byCat('Линейный', '15-17', 2400, 2200, 2000),
      ...byCat('Главный', '12-14', 3200, 3000, 2800),
    ],
  },
  { id: 'nhl', name: 'Ночная хоккейная лига (НХЛ)', year: false, active: true, rules: both(2000, 1000) },
  { id: 'chlhl', name: 'ЧЛХЛ', year: false, active: true, rules: both(2200, 1200) },
  { id: 'friendly', name: 'Товарищеская игра', year: false, active: true, rules: [{ role: '', cats: '', ages: '', price: 3000 }] },
  { id: 'city', name: 'Первенство города', year: true, active: true, rules: [] },
  { id: 'region', name: 'Первенство области', year: true, active: true, rules: [] },
  { id: 'shl', name: 'СХЛ', year: false, active: true, rules: both(4000, 2700) },
  {
    id: 'tour', name: 'Игра турнира', year: true, yearNoPrice: true, active: true,
    rules: [
      { role: 'Главный', cats: 'ВК', ages: '', price: 1900 },
      { role: 'Главный', cats: '1,2', ages: '', price: 1800 },
      { role: 'Главный', cats: '3', ages: '', price: 1700 },
      { role: 'Линейный', cats: 'ВК', ages: '', price: 1000 },
      { role: 'Линейный', cats: '1,2', ages: '', price: 900 },
      { role: 'Линейный', cats: '3', ages: '', price: 800 },
    ],
  },
  { id: 'other', name: 'Другое', free: true, year: false, active: true, rules: [] },
];
