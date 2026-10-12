/** Small emoji dictionary for the `:name` autocomplete: [emoji, space separated Russian + English names]. */
export const EMOJI_DICT: [string, string][] = [
  ['😀', 'улыбка smile grin'], ['😂', 'смех ржу joy lol'], ['🙂', 'ок слегка slight'], ['😉', 'подмигнуть wink'], ['😍', 'любовь влюблён heart_eyes'],
  ['😎', 'круто cool sunglasses'], ['🤔', 'думаю hmm think'], ['😢', 'грусть плачу sad cry'], ['😡', 'злость angry rage'], ['😱', 'шок ужас scream'],
  ['🥳', 'праздник party partying'], ['😴', 'сон спать sleep zzz'], ['🤝', 'рукопожатие договор handshake deal'], ['👍', 'класс лайк thumbsup like plus'], ['👎', 'дизлайк thumbsdown dislike'],
  ['👏', 'аплодисменты clap'], ['🙌', 'ура hands raised'], ['🙏', 'пожалуйста спасибо pray thanks please'], ['💪', 'сила muscle strong'], ['👋', 'привет wave hello'],
  ['👀', 'глаза eyes look'], ['🫡', 'салют salute'], ['❤️', 'сердце любовь heart love'], ['💜', 'фиолетовое сердце purple_heart'], ['💙', 'синее сердце blue_heart'],
  ['💚', 'зелёное сердце green_heart'], ['💛', 'жёлтое сердце yellow_heart'], ['🖤', 'чёрное сердце black_heart'], ['💔', 'разбитое сердце broken_heart'], ['💯', 'сто баллов 100 hundred'],
  ['🔥', 'огонь fire hot'], ['💥', 'взрыв boom collision'], ['⚡', 'молния зап zap lightning'], ['✨', 'искры блеск sparkles'], ['⭐', 'звезда star'],
  ['🌟', 'сияющая звезда glowing_star'], ['🎉', 'ура праздник tada party'], ['🎊', 'конфетти confetti'], ['🎁', 'подарок gift present'], ['🏆', 'кубок трофей trophy'],
  ['🥇', 'золото первое место gold medal first'], ['🥈', 'серебро silver'], ['🥉', 'бронза bronze'], ['🎖️', 'награда medal'], ['👑', 'корона crown king'],
  ['💎', 'алмаз кристалл diamond gem'], ['💰', 'деньги мешок money moneybag'], ['🪙', 'монета coin'], ['🛒', 'магазин корзина cart shop'], ['🎫', 'билет ticket'],
  ['📢', 'объявление громкоговоритель loudspeaker announce'], ['📣', 'мегафон megaphone'], ['🔔', 'колокол уведомление bell'], ['🔕', 'без звука bell_off mute'], ['📌', 'кнопка закреп pushpin pin'],
  ['📎', 'скрепка paperclip'], ['📝', 'заметка запись memo note'], ['📅', 'календарь дата calendar date'], ['🗓️', 'календарь spiral_calendar'], ['⏰', 'будильник alarm clock'],
  ['🕒', 'время часы time clock'], ['⏳', 'песочные часы hourglass wait'], ['⌛', 'песочные часы hourglass_done'], ['📍', 'метка место pin location'], ['🌍', 'мир земля earth world globe'],
  ['🗺️', 'карта map'], ['🧭', 'компас compass'], ['🏠', 'дом house home'], ['🏰', 'замок castle'], ['⛏️', 'кирка pick mining'],
  ['🪓', 'топор axe'], ['⚔️', 'мечи бой swords crossed'], ['🗡️', 'кинжал меч dagger sword'], ['🛡️', 'щит shield'], ['🏹', 'лук bow arrow'],
  ['💣', 'бомба bomb'], ['🔫', 'пистолет gun'], ['🎯', 'цель мишень target dart'], ['🎮', 'игра геймпад game controller'], ['🕹️', 'джойстик joystick'],
  ['🎲', 'кости dice'], ['🧩', 'пазл puzzle'], ['🎲', 'кубик random'], ['🛠️', 'инструменты тех работы tools hammer wrench'], ['🔧', 'ключ wrench'],
  ['🔨', 'молоток hammer'], ['⚙️', 'настройки шестерёнка gear settings'], ['🔩', 'болт bolt nut'], ['🧹', 'метла вайп broom sweep wipe'], ['🗑️', 'корзина удалить trash wastebasket'],
  ['🧪', 'колба тест test_tube lab'], ['🔬', 'микроскоп microscope'], ['💻', 'компьютер ноутбук computer laptop'], ['🖥️', 'монитор desktop monitor'], ['📱', 'телефон phone mobile'],
  ['🎧', 'наушники headphones'], ['🎤', 'микрофон microphone'], ['🎵', 'музыка нота music note'], ['📷', 'камера фото camera photo'], ['🎬', 'кино видео clapper movie'],
  ['🖼️', 'картинка frame picture'], ['📈', 'рост график chart_up growth'], ['📉', 'падение chart_down'], ['📊', 'статистика bar_chart stats'], ['🆕', 'новое new'],
  ['🆓', 'бесплатно free'], ['🔝', 'топ top'], ['🔜', 'скоро soon'], ['✅', 'готово галочка check done ok'], ['❌', 'крестик нет cross no x'],
  ['⚠️', 'внимание предупреждение warning'], ['❗', 'восклицание exclamation'], ['❓', 'вопрос question'], ['🚫', 'запрещено no_entry prohibited'], ['⛔', 'стоп stop no_entry'],
  ['🔒', 'замок закрыто lock locked'], ['🔓', 'открыто unlock'], ['🔑', 'ключ key'], ['🔗', 'ссылка link'], ['💬', 'сообщение чат speech chat'],
  ['📨', 'письмо mail envelope'], ['🚀', 'ракета запуск rocket launch'], ['🌈', 'радуга rainbow'], ['☀️', 'солнце sun'], ['🌙', 'луна moon'],
  ['❄️', 'снег холод snowflake snow'], ['🌧️', 'дождь rain'], ['🍀', 'клевер удача clover luck'], ['🍕', 'пицца pizza'], ['🍺', 'пиво beer'],
  ['☕', 'кофе coffee'], ['🎂', 'торт cake birthday'], ['🐉', 'дракон dragon'], ['🐺', 'волк wolf'], ['🦇', 'летучая мышь bat'],
  ['🧛', 'вампир vampire'], ['💀', 'череп skull'], ['👻', 'призрак ghost'], ['🧟', 'зомби zombie'], ['🤖', 'бот робот bot robot'],
  ['🟢', 'зелёный круг online green_circle'], ['🟡', 'жёлтый круг yellow_circle'], ['🔴', 'красный круг offline red_circle'], ['🔵', 'синий круг blue_circle'], ['🟣', 'фиолетовый круг purple_circle'],
  ['▶️', 'играть старт play'], ['⏸️', 'пауза pause'], ['⏹️', 'стоп stop_button'], ['🔄', 'перезапуск обновить restart refresh arrows'], ['➡️', 'стрелка вправо arrow_right'],
  ['⬅️', 'стрелка влево arrow_left'], ['⬆️', 'стрелка вверх arrow_up'], ['⬇️', 'стрелка вниз arrow_down'], ['➕', 'плюс plus'], ['➖', 'минус minus'],
  ['•', 'точка bullet dot'], ['—', 'тире dash'], ['→', 'стрелка arrow'], ['©', 'копирайт copyright'], ['™', 'товарный знак trademark'],
];

export function searchEmoji(query: string, limit = 6): [string, string][] {
  const q = query.toLowerCase().replace(/^:/, '');
  if (q.length < 2) return [];
  const starts: [string, string][] = [];
  const inside: [string, string][] = [];
  for (const e of EMOJI_DICT) {
    const words = e[1].toLowerCase().split(/\s+/);
    if (words.some((w) => w.startsWith(q))) starts.push(e);
    else if (e[1].toLowerCase().includes(q)) inside.push(e);
  }
  return [...starts, ...inside].slice(0, limit);
}
