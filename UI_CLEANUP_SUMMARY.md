# UI Cleanup & Bug Fix Summary

## Critical Bug Fix: Search

- **Root cause**: The `useEffect` had `searchQuery` in its dependency array, causing an immediate (non-debounced) API call on every keystroke that bypassed the 300ms debounce in `handleSearch`. After 2 chars, both the debounce timer and the useEffect would fire simultaneously, creating race conditions.
- **Fix**: Removed `searchQuery` from the dependency array. Used a ref (`searchQueryRef`) to access the current query when filter changes occur, so only filter changes trigger an immediate re-search.
- **Also**: Switched search API calls from bare `fetch` to `authFetch` for consistency.

## Login Form: Browser Password Saving

- Added `name="email"` / `name="password"` attributes
- Added `id` and `autocomplete` (`email`, `current-password`) attributes
- Added `autoComplete="on"` to the `<form>` element
- Added screen-reader-only `<label>` elements for accessibility
- These are the attributes browsers require to offer "Save Password" functionality

## CSS Cleanup & Design Consistency

- **Defined missing variables**: Added `--color-surface`, `--color-error`, `--color-error-bg` for both light and dark themes
- **Removed ~100 lines of dead CSS**: Old search v1 styles (`.search-input`, `.search-result-item`, `.search-matched-link`, etc.) that were superseded by v2
- **Removed duplicate declarations**: `bg-green-500`, `bg-yellow-500`, `.danger-btn`, `.calendar-legend`, `.day-cell.today`
- **Added `.sr-only` utility** for accessible hidden labels

## Login Page Visual Polish

- Refined spacing, font sizes, and border-radius to match the rest of the app's design tokens
- Added subtle background gradient matching the main app
- Improved focus states with accent-colored box-shadow rings
- Better error styling using defined CSS variables instead of fallbacks
- More consistent border and shadow treatment

## Search UX Improvements

- **Keyboard shortcut**: `Cmd/Ctrl+K` opens search, `Escape` closes it
- **Keyboard hint badge** on the search button (hidden on mobile)
- **Loading spinner** while search is in progress
- Cleaner empty-state copy
- Improved `icon-btn` hover state consistency

## Files Changed

- `src/App.tsx` - Search bug fix, login form attributes, keyboard shortcut, loading state
- `src/App.css` - Removed dead CSS, fixed duplicates, polished login & search styles
- `src/index.css` - Added missing CSS variables, `.sr-only` utility
