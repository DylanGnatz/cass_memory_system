import React, { useRef, useEffect, useCallback } from 'react'
import { useUIStore } from '../../stores/ui-store'
import { useSearch } from '../../hooks/use-search'

/** Strip HTML tags from FTS snippet for safe rendering */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

export default function SearchBar(): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    searchQuery, setSearchQuery,
    isSearchOpen, setSearchOpen,
    searchActiveIndex, setSearchActiveIndex,
    navigate
  } = useUIStore()

  const { data: results = [], isFetching } = useSearch(searchQuery)
  const hasQuery = searchQuery.length >= 2

  // Cmd+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape' && isSearchOpen) {
        setSearchOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isSearchOpen, setSearchOpen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isSearchOpen || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSearchActiveIndex(Math.min(searchActiveIndex + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSearchActiveIndex(Math.max(searchActiveIndex - 1, -1))
    } else if (e.key === 'Enter' && searchActiveIndex >= 0) {
      e.preventDefault()
      const item = results[searchActiveIndex]
      navigateToResult(item)
    }
  }, [isSearchOpen, results, searchActiveIndex, setSearchActiveIndex])

  const navigateToResult = useCallback((item: any) => {
    if (item.type === 'knowledge') {
      navigate({ type: 'knowledge', slug: item.id })
    } else if (item.type === 'session') {
      navigate({ type: 'session', id: item.id })
    } else if (item.type === 'digest') {
      navigate({ type: 'digest', date: item.id })
    }
    setSearchOpen(false)
    setSearchQuery('')
    inputRef.current?.blur()
  }, [navigate, setSearchOpen, setSearchQuery])

  return (
    <div className="searchbar">
      <span className="searchbar__icon">&#x2315;</span>
      <input
        ref={inputRef}
        className="searchbar__input"
        type="text"
        placeholder="Search knowledge base..."
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value)
          setSearchActiveIndex(-1)
        }}
        onFocus={() => { if (searchQuery.length >= 2) setSearchOpen(true) }}
        onKeyDown={handleKeyDown}
      />
      <span className="searchbar__shortcut">&#x2318;K</span>

      {isSearchOpen && hasQuery && (
        <div className="search-dropdown">
          {isFetching && results.length === 0 ? (
            <div className="search-result" style={{ justifyContent: 'center', color: 'var(--text-tertiary)', cursor: 'default' }}>
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="search-result" style={{ justifyContent: 'center', color: 'var(--text-tertiary)', cursor: 'default' }}>
              No results. The search index may be empty — run reflection to index content.
            </div>
          ) : (
            results.map((item: any, i: number) => (
              <div
                key={`${item.type}-${item.id}-${i}`}
                className={`search-result ${i === searchActiveIndex ? 'search-result--active' : ''}`}
                onClick={() => navigateToResult(item)}
                onMouseEnter={() => setSearchActiveIndex(i)}
              >
                <span className={`search-result__badge search-result__badge--${item.type}`}>
                  {item.type}
                </span>
                <div className="search-result__body">
                  <div className="search-result__title">{item.title}</div>
                  <div className="search-result__snippet">
                    {stripHtml(item.snippet)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
