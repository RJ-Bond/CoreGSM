/** Step-by-step «how to connect» instructions per game (Russian). Used by the «Подключение» tab of the server page. */

export interface ConnectGuide {
  title: string;
  steps: string[];
  /** values the player has to paste somewhere; each one gets a copy button */
  copy: { label: string; value: string }[];
  /** a protocol link that starts the game (steam://, ts3server:// ...) */
  link?: { label: string; href: string };
}

/** "host:27015" -> { host, port }; a bare host has an empty port; IPv6 in brackets is understood */
export function splitAddress(address: string): { host: string; port: string } {
  const a = address.trim();
  const m6 = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(a);
  if (m6) return { host: m6[1], port: m6[2] ?? '' };
  const i = a.lastIndexOf(':');
  if (i > 0 && a.indexOf(':') === i && /^\d{1,5}$/.test(a.slice(i + 1))) return { host: a.slice(0, i), port: a.slice(i + 1) };
  return { host: a, port: '' };
}

const SOURCE_CONSOLE = new Set(['counterstrike2', 'csgo', 'counterstrike16', 'css', 'teamfortress2', 'garrysmod', 'l4d2']);

export function connectGuide(game: string, address: string): ConnectGuide {
  const addr = address.trim();
  const { host, port } = splitAddress(addr);
  const copy: ConnectGuide['copy'] = [{ label: 'Адрес', value: addr }];
  if (port) copy.push({ label: 'Хост', value: host }, { label: 'Порт', value: port });
  const portNote = port ? '' : ' Порт указывать не нужно: используется стандартный.';
  let steps: string[];
  let title: string;
  let link: ConnectGuide['link'];

  if (SOURCE_CONSOLE.has(game)) {
    const names: Record<string, string> = {
      counterstrike2: 'Counter-Strike 2', csgo: 'CS:GO', counterstrike16: 'Counter-Strike 1.6', css: 'Counter-Strike: Source',
      teamfortress2: 'Team Fortress 2', garrysmod: "Garry's Mod", l4d2: 'Left 4 Dead 2',
    };
    title = `Как подключиться: ${names[game]}`;
    copy.push({ label: 'Команда для консоли', value: `connect ${addr}` });
    steps = [
      'Запустите Steam и игру.',
      game === 'counterstrike2'
        ? 'В настройках игры включите консоль разработчика (Игра → Включить консоль разработчика) и откройте её клавишей ~ (Ё).'
        : 'Откройте консоль клавишей ~ (Ё). Если консоль не открывается, включите её в настройках клавиатуры или параметрах запуска (-console).',
      `Вставьте команду connect ${addr} и нажмите Enter.`,
      'Либо нажмите кнопку «Подключиться» ниже: Steam сам запустит игру и присоединит вас к серверу.',
    ];
    link = { label: 'Подключиться через Steam', href: `steam://connect/${addr}` };
  } else {
    switch (game) {
      case 'minecraft':
        title = 'Как подключиться: Minecraft (Java Edition)';
        steps = [
          'Запустите Minecraft Java Edition и выберите версию игры, совпадающую с версией сервера.',
          'Откройте «Сетевая игра» и нажмите «Добавить сервер» (или «Прямое подключение»).',
          `Вставьте адрес сервера в поле «Адрес сервера».${portNote}`,
          'Нажмите «Готово» и затем дважды щёлкните по серверу в списке.',
        ];
        break;
      case 'mbe':
        title = 'Как подключиться: Minecraft (Bedrock Edition)';
        steps = [
          'Запустите Minecraft Bedrock Edition (Windows, консоль или мобильная версия).',
          'Откройте «Играть», вкладку «Серверы», прокрутите вниз и нажмите «Добавить сервер».',
          'В поле «Имя сервера» напишите любое название, в поле «Адрес сервера» вставьте хост, в поле «Порт» вставьте порт (по умолчанию 19132).',
          'Сохраните и выберите добавленный сервер в списке.',
        ];
        break;
      case 'vrising':
        title = 'Как подключиться: V Rising';
        steps = [
          'Запустите V Rising через Steam.',
          'В главном меню нажмите «Play» → «Online Play» (или «Play Online»).',
          'Откройте «Server Browser» и найдите сервер по названию: списку может понадобиться пара секунд, чтобы прогрузиться.',
          `Либо нажмите «Direct Connect» и вставьте адрес ${addr}${port ? '' : ' с портом'}, затем введите пароль, если он есть.`,
        ];
        break;
      case 'rust':
        title = 'Как подключиться: Rust';
        copy.push({ label: 'Команда для консоли', value: `client.connect ${addr}` });
        steps = [
          'Запустите Rust через Steam.',
          'В главном меню нажмите F1 и откройте консоль.',
          `Введите client.connect ${addr} и нажмите Enter.`,
          'Или нажмите кнопку «Подключиться» ниже, либо найдите сервер по названию в списке «Modded» / «Community».',
        ];
        link = { label: 'Подключиться через Steam', href: `steam://connect/${addr}` };
        break;
      case 'valheim':
        title = 'Как подключиться: Valheim';
        steps = [
          'Запустите Valheim, выберите персонажа и нажмите «Start».',
          'В разделе «Join Game» откройте вкладку «Join IP» (внизу списка серверов) или нажмите «Add server».',
          `Введите адрес ${addr}${port ? '' : ':2456'} и нажмите «Connect». Если спросит пароль, введите пароль сервера.`,
          'Обратите внимание: у сервера открываются порты N, N+1 и N+2 по UDP, порт для входа указывают первым (по умолчанию 2456).',
        ];
        break;
      case 'palworld':
        title = 'Как подключиться: Palworld';
        steps = [
          'Запустите Palworld и нажмите «Join Multiplayer Game».',
          'Внизу списка серверов найдите поле «Enter address to connect» и вставьте адрес сервера с портом (по умолчанию 8211).',
          'Нажмите «Connect». Если нужен пароль, игра попросит его после подключения.',
        ];
        break;
      case 'ase':
        title = 'Как подключиться: ARK: Survival Evolved';
        copy.push({ label: 'Команда для консоли', value: `open ${addr}` });
        steps = [
          'Запустите ARK: Survival Evolved через Steam.',
          'Нажмите «Join ARK», слева выберите «Unofficial», включите фильтр «Show Player Servers» и найдите сервер по названию.',
          `Или откройте консоль клавишей Tab, введите open ${addr} и нажмите Enter.`,
          'Либо используйте кнопку «Подключиться» ниже.',
        ];
        link = { label: 'Подключиться через Steam', href: `steam://connect/${addr}` };
        break;
      case 'asa':
        title = 'Как подключиться: ARK: Survival Ascended';
        steps = [
          'Запустите ARK: Survival Ascended.',
          'Нажмите «Join Game», выберите «Unofficial» (или «Favorites» → добавьте сервер по IP).',
          'В строке поиска введите название сервера, при необходимости снимите лишние фильтры (в том числе «Show Password Protected»).',
          'Выберите сервер, нажмите «Join» и введите пароль, если он есть.',
        ];
        break;
      case 'terraria':
        title = 'Как подключиться: Terraria';
        steps = [
          'Запустите Terraria и выберите персонажа.',
          'Нажмите «Multiplayer» → «Join via IP».',
          'Введите IP-адрес сервера, затем порт (по умолчанию 7777).',
          'Если сервер защищён паролем, игра попросит его при подключении.',
        ];
        break;
      case 'factorio':
        title = 'Как подключиться: Factorio';
        steps = [
          'Запустите Factorio и нажмите «Multiplayer».',
          'Выберите «Connect to address».',
          `Вставьте адрес ${addr}${port ? '' : ' (порт по умолчанию 34197)'} и нажмите «Connect».`,
          'Версия игры и список модов должны совпадать с серверными.',
        ];
        break;
      case 'sdtd':
        title = 'Как подключиться: 7 Days to Die';
        steps = [
          'Запустите 7 Days to Die и откройте «Join A Game».',
          'Нажмите «Connect to IP» и введите IP-адрес и порт сервера (по умолчанию 26900).',
          'Если сервер с паролем, введите его. Нажмите «Connect».',
          'Либо найдите сервер по названию во вкладке «Internet» и добавьте в избранное звёздочкой.',
        ];
        break;
      case 'dayz':
        title = 'Как подключиться: DayZ';
        steps = [
          'Запустите DayZ через Steam. Если сервер с модами, сначала установите все нужные моды из Steam Workshop (удобно через DZSA Launcher).',
          'В игре откройте «Server Browser», найдите сервер по названию или откройте вкладку «Favorites» и добавьте адрес вручную.',
          'Можно также добавить адрес в Steam: «Вид» → «Серверы» → «Избранное» → «Добавить сервер».',
          'Нажмите «Connect».',
        ];
        link = { label: 'Подключиться через Steam', href: `steam://connect/${addr}` };
        break;
      case 'projectzomboid':
        title = 'Как подключиться: Project Zomboid';
        steps = [
          'Запустите Project Zomboid и нажмите «Join».',
          'Нажмите «Add server» и заполните поля: «Server name» (любое), «IP» (хост) и «Port» (по умолчанию 16261).',
          'Введите имя пользователя и пароль (пароль нужно придумать при первом входе, если на сервере разрешена регистрация).',
          'Сохраните, выберите сервер и нажмите «Join».',
        ];
        break;
      case 'icarus':
        title = 'Как подключиться: Icarus';
        steps = [
          'Запустите Icarus и войдите в «Open World» / «Join Game».',
          'Откройте «Lobby Browser» и найдите сервер по названию (поиск по имени работает без учёта регистра).',
          'Выберите сервер и нажмите «Join». Если у сервера пароль, введите его.',
        ];
        break;
      case 'unturned':
        title = 'Как подключиться: Unturned';
        steps = [
          'Запустите Unturned и нажмите «Play» → «Connect».',
          'Выберите «Connect by IP» (или найдите сервер во вкладке «Internet» по названию).',
          'Введите IP-адрес, порт (по умолчанию 27015) и пароль, если он есть.',
          'Нажмите «Connect». Кнопка «Подключиться» ниже откроет Steam с тем же адресом.',
        ];
        link = { label: 'Подключиться через Steam', href: `steam://connect/${addr}` };
        break;
      case 'conanexiles':
        title = 'Как подключиться: Conan Exiles';
        steps = [
          'Запустите Conan Exiles и нажмите «Online».',
          'Нажмите «Direct Connect» (или откройте «Server Browser» и найдите сервер по названию).',
          `Вставьте адрес ${addr}${port ? '' : ':7777'} (используется игровой порт) и нажмите «Connect».`,
          'Если у сервера есть пароль, введите его.',
        ];
        break;
      case 'gta5f': {
        title = 'Как подключиться: FiveM (GTA V)';
        copy.push({ label: 'Команда для консоли', value: `connect ${addr}` });
        steps = [
          'Установите и запустите FiveM (нужна лицензионная копия GTA V).',
          'В главном меню FiveM нажмите «Direct Connect» и вставьте адрес сервера, либо найдите сервер в списке «Servers».',
          `Можно открыть консоль клавишей F8 и ввести connect ${addr}.`,
          'Нажмите «Подключиться» ниже, чтобы запустить FiveM автоматически.',
        ];
        link = { label: 'Подключиться через FiveM', href: `fivem://connect/${addr}` };
        break;
      }
      case 'gtasam':
        title = 'Как подключиться: SA-MP (GTA San Andreas)';
        steps = [
          'Установите GTA San Andreas и клиент SA-MP (или откройте лаунчер, например Open.MP).',
          'Запустите SA-MP, перейдите на вкладку «Favorites» и нажмите «Add server».',
          'Введите адрес сервера с портом (по умолчанию 7777) и в верхнем поле укажите свой ник.',
          'Дважды щёлкните по серверу в списке или нажмите «Connect».',
        ];
        break;
      case 'teamspeak3': {
        title = 'Как подключиться: TeamSpeak 3';
        steps = [
          'Установите и запустите клиент TeamSpeak 3.',
          'Нажмите «Подключения» → «Подключиться» (Ctrl+S).',
          `Вставьте адрес в поле «Адрес сервера»${port ? ' (порт при необходимости можно указать после двоеточия)' : ''}, укажите ник и нажмите «Подключиться».`,
          'Если сервер защищён паролем, введите его в поле «Пароль сервера».',
        ];
        link = { label: 'Подключиться через TeamSpeak', href: `ts3server://${host}${port && port !== '9987' ? `?port=${port}` : ''}` };
        break;
      }
      default:
        title = 'Как подключиться';
        steps = [
          'Запустите игру и убедитесь, что версия клиента совпадает с версией сервера.',
          'Откройте список серверов или пункт «Прямое подключение» / «Connect by IP» в меню игры.',
          'Вставьте адрес сервера и, если игра просит отдельно, порт.',
          'Если сервер с паролем, введите его при подключении.',
        ];
    }
  }
  return { title, steps, copy, link };
}

/** a game profile's connect block (GET /games): templates use {address}, {host} and {port} */
export interface ConnectTemplates { steam?: string; command?: string; note?: string }

/** fills {address}, {host} and {port}; `fallbackPort` stands in for a missing port (the game's default) */
export function fillConnectTemplate(tpl: string, address: string, fallbackPort?: number | string): string {
  const addr = address.trim();
  const { host, port } = splitAddress(addr);
  const p = port || (fallbackPort != null ? String(fallbackPort) : '');
  return tpl.replace(/\{address\}/g, addr).replace(/\{host\}/g, host).replace(/\{port\}/g, p);
}

/** only links that hand the user over to a game or launcher; never script or data urls */
export const isSafeConnectHref = (href: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(href) && !/^(javascript|data|vbscript|file|blob):/i.test(href);

/**
 * The built-in guide with the server-provided connect templates applied: the command replaces (or adds) the console command,
 * the steam template becomes the connect link. Without templates the guide is returned unchanged.
 */
export function applyConnectTemplates(guide: ConnectGuide, connect: ConnectTemplates | null | undefined, address: string, defaultPort?: number): ConnectGuide {
  if (!connect) return guide;
  let { copy, link } = guide;
  const command = typeof connect.command === 'string' && connect.command.trim() ? fillConnectTemplate(connect.command.trim(), address, defaultPort) : '';
  if (command) {
    const at = copy.findIndex((c) => /команд/i.test(c.label));
    copy = at >= 0 ? copy.map((c, i) => (i === at ? { ...c, value: command } : c)) : [copy[0], { label: 'Команда для консоли', value: command }, ...copy.slice(1)].filter(Boolean);
  }
  const steam = typeof connect.steam === 'string' && connect.steam.trim() ? fillConnectTemplate(connect.steam.trim(), address, defaultPort) : '';
  if (steam && isSafeConnectHref(steam)) {
    link = { label: steam.startsWith('steam://') ? 'Подключиться через Steam' : 'Подключиться', href: steam };
  }
  return { ...guide, copy, link };
}
