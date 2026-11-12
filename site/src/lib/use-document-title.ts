import { useEffect } from 'react'

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}

export const pageTitle = (name: string) => `${name} · Forge402`
export const HOME_TITLE = 'Forge402 · One endpoint for every open model on Robinhood Chain'
