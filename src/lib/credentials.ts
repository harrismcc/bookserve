// Credential rules shared by setup and user management (server-side validators).

// Same rule as the username plugin; checked first so the synthetic email is always valid.
export function checkUsername(username: string) {
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) {
    throw new Error(
      'Username must be 3–30 letters, numbers, underscores, or dots',
    )
  }
}

export function checkPassword(password: string) {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }
}
