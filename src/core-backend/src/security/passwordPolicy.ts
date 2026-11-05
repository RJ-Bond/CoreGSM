/**
 * What a password must look like. The minimum is 8 characters for a player and 12 for an administrator or a moderator
 * (their accounts can change the whole panel). A password from the list of the most common ones, the same as the name
 * of the account, one character repeated or a plain run («12345678», «abcdefgh») is refused whatever its length.
 * The list is checked offline: nothing is sent anywhere.
 */

export type PasswordRole = 'admin' | 'moderator' | 'player';

export const MIN_LENGTH: Record<PasswordRole, number> = { admin: 12, moderator: 12, player: 8 };

// the most common passwords of the public leaks (lower case), with the keyboard runs of both layouts
const COMMON = new Set(
  `123456 1234567 12345678 123456789 1234567890 12345678910 123123 1231234 121212 112233 111111 000000 222222 654321 7654321
  987654321 0987654321 123321 123qwe 123qweasd 1q2w3e4r 1q2w3e4r5t 1q2w3e 1qaz2wsx 1qazxsw2 q1w2e3r4 q1w2e3r4t5 zaq12wsx
  qwerty qwerty1 qwerty12 qwerty123 qwerty1234 qwertyuiop qwertyui asdfgh asdfghjk asdfghjkl zxcvbn zxcvbnm qazwsx qazwsxedc
  qweasd qweasdzxc qwe123 asd123 zxc123 password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword
  pass1234 pass12345 passwort pa55word letmein welcome welcome1 welcome123 admin admin1 admin12 admin123 admin1234 administrator
  root toor changeme changeme123 default guest user test test123 test1234 testing temp temp123 secret secret123 master login
  abc123 abc1234 abc12345 abcd1234 abcdefgh abcdefg abcdef a1b2c3 a1b2c3d4 aaaaaa aaaaaaaa aaa111 qqqqqq zzzzzz iloveyou
  iloveyou1 princess monkey dragon sunshine shadow football baseball superman batman trustno1 starwars master123 hello hello123
  hunter hunter2 whatever freedom lovely michael jordan jessica charlie donald computer internet minecraft minecraft123 rust rust123
  rustserver counterstrike steam steam123 gaming gamer gamer123 coregsm coregsm123 server server123 gameserver monitoring
  пароль пароль1 пароль123 йцукен йцукен123 йцукенгшщзх фыва фывапролдж ячсмить привет привет123 админ админ123 qazwsxedcrfv
  1111 11111 111111 1111111 11111111 0123456789 01234567 12341234 12344321 11223344 1122334455 123454321 147258369 159357 741852963
  963852741 321321 369369 456456 456789 789456 789456123 147852369 1357924680 2468013579 14789632 12qwaszx 1q1q1q1q 1a2b3c4d
  samsung google facebook iphone android linux ubuntu windows windows10 mypassword mypass newpassword newpass pass password!
  zaq1xsw2 zaq1zaq1 qweqwe qweqweqwe asdasd asdasdasd zxczxc zxczxczxc 1234qwer 1234qwerty qwer1234 qwer4321 asdf1234 asdfasdf
  zxcv1234 q1234567 a1234567 z1234567 aa123456 aa12345678 password01 password2 passw0rd1 Password1 Qwerty123 Admin123`
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase()),
);

/** the same character repeated, or every next one is the previous plus or minus one («12345678», «hgfedcba») */
function isRun(pw: string): boolean {
  if (pw.length < 4) return false;
  if (new Set(pw).size === 1) return true;
  let up = true;
  let down = true;
  for (let i = 1; i < pw.length; i++) {
    const d = pw.charCodeAt(i) - pw.charCodeAt(i - 1);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

export type PasswordProblem = 'short' | 'short_admin' | 'common' | 'same_as_name' | 'run' | null;

/** null when the password is acceptable, otherwise what is wrong with it (the caller maps it to a message) */
export function passwordProblem(password: string, opts: { username?: string; role?: PasswordRole } = {}): PasswordProblem {
  const role = opts.role ?? 'player';
  const pw = password;
  const low = pw.toLowerCase();
  if (pw.length < MIN_LENGTH[role]) return role === 'player' ? 'short' : 'short_admin';
  if (COMMON.has(low)) return 'common';
  const name = (opts.username ?? '').trim().toLowerCase();
  if (name && (low === name || (name.length >= 4 && low.includes(name) && low.length <= name.length + 3))) return 'same_as_name';
  if (isRun(low)) return 'run';
  return null;
}

/** Russian text for the API (the panel translates it by the code in errors.ts) */
export const PASSWORD_MESSAGES: Record<Exclude<PasswordProblem, null>, string> = {
  short: 'Пароль должен быть не короче 8 символов',
  short_admin: 'Для администратора и модератора пароль должен быть не короче 12 символов',
  common: 'Этот пароль слишком простой: он входит в список самых частых. Придумайте другой',
  same_as_name: 'Пароль не должен совпадать с именем аккаунта',
  run: 'Пароль не должен быть повторяющимся или простой последовательностью',
};

/** the message for a password, or null when it is fine */
export function passwordError(password: string, opts: { username?: string; role?: PasswordRole } = {}): string | null {
  const p = passwordProblem(password, opts);
  return p ? PASSWORD_MESSAGES[p] : null;
}
