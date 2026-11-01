import { createContext } from 'react'

// The Settings section that's showing, so a permission asked for there comes back to it after a
// restart (src/permissions.js).
export const SettingsAt = createContext(null)
