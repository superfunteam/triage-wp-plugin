import { useState, useEffect, useCallback } from 'react'
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge } from '@/components/ui/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import './index.css'

// Types
interface PostType {
  name: string
  label: string
  count: number
}

interface Post {
  id: number
  title: string
  status: string
}

interface PostMeta {
  id: number
  title: string
  post_type: string
  status: string
  categories: string[]
  tags: string[]
  permalink: string
  edit_link: string
}

interface TrafficData {
  sessions?: number
  active_users?: number
  new_users?: number
  avg_engagement_time?: number
  key_events?: number
}

declare global {
  interface Window {
    wpTriage: {
      ajaxUrl: string
      nonce: string
    }
  }
}

const STORAGE_KEY = 'wp_triage_kept'

// AJAX helper
function ajax<T>(action: string, data: Record<string, string | number> = {}): Promise<{ success: boolean; data: T }> {
  const form = new FormData()
  form.append('action', action)
  form.append('nonce', window.wpTriage.nonce)
  for (const [k, v] of Object.entries(data)) {
    form.append(k, String(v))
  }
  return fetch(window.wpTriage.ajaxUrl, { method: 'POST', body: form }).then(r => r.json())
}

function getSlugFromPermalink(permalink: string): string {
  try {
    const url = new URL(permalink)
    let path = url.pathname
    path = path.replace(/^\/|\/$/g, '')
    return path || '/'
  } catch {
    return ''
  }
}

export default function App() {
  // State
  const [postTypes, setPostTypes] = useState<PostType[]>([])
  const [currentType, setCurrentType] = useState<string | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [currentMeta, setCurrentMeta] = useState<PostMeta | null>(null)
  const [reviewed, setReviewed] = useState<Set<number>>(new Set())
  const [kept, setKept] = useState<Set<number>>(() => new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [linksOut, setLinksOut] = useState<Record<number, number[]>>({})
  const [linksIn, setLinksIn] = useState<Record<number, number[]>>({})
  const [traffic, setTraffic] = useState<Record<string, TrafficData>>({})
  const [isMobileView, setIsMobileView] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showPostsPanel, setShowPostsPanel] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false)

  // Save kept to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...kept]))
  }, [kept])

  // URL state management
  const updateURL = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('page', 'wp-triage')

    if (currentType) {
      params.set('type', currentType)
    } else {
      params.delete('type')
    }

    const currentPost = posts[currentIndex]
    if (currentPost) {
      params.set('post', String(currentPost.id))
    } else {
      params.delete('post')
    }

    const newURL = `${window.location.pathname}?${params.toString()}`
    window.history.replaceState({}, '', newURL)
  }, [currentType, posts, currentIndex])

  // Get total remaining count
  const getTotalRemaining = useCallback(() => {
    const totalPosts = postTypes.reduce((sum, t) => sum + t.count, 0)
    return totalPosts - kept.size
  }, [postTypes, kept])

  // Load post metadata
  const loadPost = useCallback((postId: number) => {
    ajax<PostMeta>('wp_triage_get_post_meta', { post_id: postId }).then(res => {
      if (!res.success) return
      setCurrentMeta(res.data)
    })
  }, [])

  // Find and load next unreviewed post
  const findNextPost = useCallback((postList: Post[], fromIndex: number, reviewedSet: Set<number>) => {
    for (let i = fromIndex + 1; i < postList.length; i++) {
      if (!reviewedSet.has(postList[i].id)) {
        setCurrentIndex(i)
        loadPost(postList[i].id)
        return true
      }
    }
    return false
  }, [loadPost])

  // Select a post type
  const selectType = useCallback((typeName: string, initialPostId: number | null = null) => {
    setCurrentType(typeName)
    setReviewed(new Set())
    setShowPostsPanel(true)
    setIsLoading(true)

    ajax<Post[]>('wp_triage_get_posts', { post_type: typeName }).then(res => {
      if (!res.success) return
      setPosts(res.data)
      setIsLoading(false)
      setSelected(new Set())

      if (initialPostId) {
        const postIndex = res.data.findIndex(p => p.id === initialPostId)
        if (postIndex !== -1) {
          setCurrentIndex(postIndex)
          loadPost(initialPostId)
          return
        }
      }
      // Find next unreviewed post
      for (let i = 0; i < res.data.length; i++) {
        setCurrentIndex(i)
        loadPost(res.data[i].id)
        return
      }
    })
  }, [loadPost])

  // Load post types on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlType = params.get('type')
    const urlPostId = params.get('post') ? parseInt(params.get('post')!, 10) : null

    // Collapse WP admin sidebar
    document.body.classList.add('folded')

    ajax<PostType[]>('wp_triage_get_post_types').then(res => {
      if (!res.success) return
      setPostTypes(res.data)

      if (urlType) {
        selectType(urlType, urlPostId)
      }
    })

    ajax<{ out: Record<number, number[]>; in: Record<number, number[]> }>('wp_triage_get_link_map').then(res => {
      if (!res.success) return
      setLinksOut(res.data.out)
      setLinksIn(res.data.in)
    })

    ajax<Record<string, TrafficData>>('wp_triage_get_traffic').then(res => {
      if (!res.success) return
      setTraffic(res.data)
    })
  }, [selectType])

  // Update URL when state changes
  useEffect(() => {
    updateURL()
  }, [currentType, currentIndex, updateURL])

  // Go to next post
  const nextPost = useCallback(() => {
    const found = findNextPost(posts, currentIndex, reviewed)
    if (!found) {
      // Move to next post type
      const nextTypeIndex = postTypes.findIndex(t => t.name === currentType) + 1
      if (nextTypeIndex < postTypes.length) {
        selectType(postTypes[nextTypeIndex].name)
      } else {
        setCurrentMeta(null) // Show done state
      }
    }
  }, [posts, currentIndex, reviewed, postTypes, currentType, findNextPost, selectType])

  // Go back to types
  const goBackToTypes = () => {
    setShowPostsPanel(false)
    setCurrentType(null)
    setCurrentIndex(-1)
    setCurrentMeta(null)
  }

  // Unpublish current post
  const unpublish = useCallback(() => {
    const post = posts[currentIndex]
    if (!post) return

    ajax<{ id: number; status: string }>('wp_triage_unpublish', { post_id: post.id }).then(res => {
      if (!res.success) return
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'draft' } : p))
      setReviewed(prev => new Set([...prev, post.id]))
      nextPost()
    })
  }, [posts, currentIndex, nextPost])

  // Keep current post
  const keep = useCallback(() => {
    const post = posts[currentIndex]
    if (!post) return
    setKept(prev => new Set([...prev, post.id]))
    setReviewed(prev => new Set([...prev, post.id]))
    nextPost()
  }, [posts, currentIndex, nextPost])

  // Bulk unpublish
  const bulkUnpublish = () => {
    const selectedIds = [...selected]
    let completed = 0

    selectedIds.forEach(postId => {
      ajax<{ id: number; status: string }>('wp_triage_unpublish', { post_id: postId }).then(res => {
        if (res.success) {
          setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: 'draft' } : p))
          setReviewed(prev => new Set([...prev, postId]))
        }
        completed++
        if (completed === selectedIds.length) {
          setSelected(new Set())
          setBulkActionsOpen(false)
          nextPost()
        }
      })
    })
  }

  // Bulk keep
  const bulkKeep = () => {
    const selectedIds = [...selected]
    setKept(prev => new Set([...prev, ...selectedIds]))
    setReviewed(prev => new Set([...prev, ...selectedIds]))
    setSelected(new Set())
    setBulkActionsOpen(false)
    nextPost()
  }

  // Toggle post selection
  const togglePostSelection = (postId: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(postId)) {
        next.delete(postId)
      } else {
        next.add(postId)
      }
      return next
    })
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // Escape to close modals or unpublish
      if (e.key === 'Escape') {
        if (bulkActionsOpen) {
          setBulkActionsOpen(false)
          return
        }
        if (permissionsOpen) {
          setPermissionsOpen(false)
          return
        }
        unpublish()
        return
      }

      // Space to keep
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        keep()
        return
      }

      // Legacy shortcuts
      if (e.key === 'ArrowLeft' || e.key === 'u') unpublish()
      if (e.key === 'ArrowRight' || e.key === 'k') keep()

      // Up/Down arrows to navigate
      if (e.key === 'ArrowUp' && posts.length > 0) {
        e.preventDefault()
        const newIndex = Math.max(0, currentIndex - 1)
        if (newIndex !== currentIndex) {
          setCurrentIndex(newIndex)
          loadPost(posts[newIndex].id)
        }
      }
      if (e.key === 'ArrowDown' && posts.length > 0) {
        e.preventDefault()
        const newIndex = Math.min(posts.length - 1, currentIndex + 1)
        if (newIndex !== currentIndex) {
          setCurrentIndex(newIndex)
          loadPost(posts[newIndex].id)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [unpublish, keep, posts, currentIndex, bulkActionsOpen, permissionsOpen, loadPost])

  // Get traffic data for current post
  const currentTraffic = currentMeta ? traffic[getSlugFromPermalink(currentMeta.permalink)] || {} : {}
  const sessions = currentTraffic.sessions || 0
  const slug = currentMeta ? getSlugFromPermalink(currentMeta.permalink) : ''
  const isTopLevel = slug && slug !== '/' && !slug.includes('/')

  // Remaining counts
  const keptInCurrentType = posts.filter(p => kept.has(p.id)).length
  const remainingInType = posts.length - keptInCurrentType

  // AI link helper URL
  const getAiLinkUrl = () => {
    if (!currentMeta) return '#'
    const productionPermalink = currentMeta.permalink.replace(/^https?:\/\/[^\/]+/, 'https://sourceday.com')
    const aiPrompt = `The content at ${productionPermalink} is valuable and needs more internal links pointing to it. Analyze my site and find THREE existing pages or posts that should link TO this content. For each, explain where the link should be placed and what anchor text to use.`
    return `https://chatgpt.com/g/g-692755ed9bf0819182ad27cedf7d22d2?prompt=${encodeURIComponent(aiPrompt)}`
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-52px)] mr-5 mt-5 mb-5 font-sans">
      <div className="flex gap-4 flex-1">
        {/* Sidebar */}
        <Sidebar className="w-60 flex-shrink-0 bg-transparent border-none">
          <SidebarContent className="overflow-hidden">
            <div className="flex w-[200%] transition-transform duration-300" style={{ transform: showPostsPanel ? 'translateX(-50%)' : 'translateX(0)' }}>
              {/* Post Types Panel */}
              <div className="w-1/2 p-0">
                <SidebarHeader className="px-0 pt-0">
                  <div className="flex items-center justify-between text-sm font-semibold text-foreground">
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-lg">book_5</span>
                      Your Post Types
                    </span>
                    <Badge variant="muted" className="text-xs">{getTotalRemaining()}</Badge>
                  </div>
                </SidebarHeader>
                <SidebarMenu className="px-0">
                  {postTypes.map(type => (
                    <SidebarMenuItem key={type.name}>
                      <SidebarMenuButton
                        isActive={currentType === type.name}
                        onClick={() => selectType(type.name)}
                        className={cn(
                          "justify-between",
                          currentType === type.name && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                        )}
                      >
                        <span>{type.label}</span>
                        <SidebarMenuBadge className={cn(
                          currentType === type.name && "bg-white/20 text-white"
                        )}>
                          {type.count}
                        </SidebarMenuBadge>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>

              {/* Posts Panel */}
              <div className="w-1/2 flex flex-col max-h-[calc(100vh-140px)]">
                <div className="flex-1 overflow-y-auto min-h-0">
                  {/* Back Button */}
                  <Button
                    variant="secondary"
                    onClick={goBackToTypes}
                    className="w-full justify-between mb-3 rounded-2xl"
                  >
                    <span>&larr; All Types</span>
                    <span className="text-xs text-muted-foreground">{getTotalRemaining()} left</span>
                  </Button>

                  {/* Posts Header */}
                  <div className="flex items-center justify-between text-sm font-semibold text-foreground mb-3">
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-lg">lab_profile</span>
                      {postTypes.find(t => t.name === currentType)?.label || ''}
                    </span>
                    <Badge variant="muted" className="text-xs min-w-[54px] text-center">{remainingInType} left</Badge>
                  </div>

                  {/* Posts List */}
                  <div className="space-y-0.5">
                    {isLoading ? (
                      <div className="text-sm text-muted-foreground py-2 px-3">Loading...</div>
                    ) : (
                      posts.map((post, index) => (
                        <button
                          key={post.id}
                          onClick={() => {
                            setCurrentIndex(index)
                            loadPost(post.id)
                          }}
                          className={cn(
                            "w-full text-left flex items-center gap-1.5 py-2 px-2.5 pr-14 text-sm rounded-md transition-colors relative",
                            index === currentIndex
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-accent",
                            reviewed.has(post.id) && "opacity-40 line-through"
                          )}
                        >
                          <label
                            className="flex items-center justify-center shrink-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={selected.has(post.id)}
                              onCheckedChange={() => togglePostSelection(post.id)}
                              className={cn(
                                "w-3.5 h-3.5 opacity-40 hover:opacity-100",
                                selected.has(post.id) && "opacity-100",
                                index === currentIndex && "border-white/60 data-[state=checked]:bg-transparent data-[state=checked]:border-white"
                              )}
                            />
                          </label>
                          <span className="flex-1 min-w-0 truncate">{post.title}</span>
                          {post.status !== 'publish' && (
                            <span className={cn(
                              "absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded font-medium",
                              post.status === 'draft'
                                ? "bg-orange-500/15 text-orange-600 border border-orange-500/30"
                                : "bg-muted",
                              index === currentIndex && "bg-white/20 text-white border-0"
                            )}>
                              {post.status.charAt(0).toUpperCase() + post.status.slice(1)}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Bulk Actions */}
                {selected.size > 0 && (
                  <div className="shrink-0 pt-4 mt-auto border-t">
                    <Button
                      onClick={() => setBulkActionsOpen(true)}
                      className="w-full"
                    >
                      Actions <Badge variant="secondary" className="ml-2 bg-white/20">{selected.size}</Badge>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </SidebarContent>
        </Sidebar>

        {/* Main Panel */}
        <Card className="flex-1 min-w-0 overflow-hidden flex flex-col rounded-3xl">
          {!currentMeta && !currentType && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Select a post type to begin
            </div>
          )}

          {!currentMeta && currentType && posts.length > 0 && !isLoading && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              All done! No more posts to review.
            </div>
          )}

          {currentMeta && (
            <div className="flex flex-1 max-h-[calc(100vh-112px)]">
              {/* Left Meta Column */}
              <div className="w-[340px] shrink-0 p-6 flex flex-col max-h-full overflow-hidden">
                <div className="flex-1 overflow-y-auto min-h-0">
                  {/* Badges */}
                  <div className="mb-1 flex gap-1.5 flex-wrap">
                    {kept.has(currentMeta.id) && (
                      <Badge variant="success" className="text-xs">Kept</Badge>
                    )}
                    {sessions >= 75 && (
                      <Badge variant="warning" className="text-xs">Top 100</Badge>
                    )}
                    {isTopLevel && (
                      <Badge variant="info" className="text-xs">Top Level</Badge>
                    )}
                  </div>

                  {/* Title */}
                  <h1 className="text-xl font-semibold text-foreground mb-4 leading-tight">
                    {currentMeta.title}
                  </h1>

                  {/* Meta Table */}
                  <div className="rounded-lg overflow-hidden bg-muted/50">
                    <Table>
                      <TableBody>
                        <TableRow className="border-muted">
                          <TableCell className="w-28 text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">description</span>
                              Post Type
                            </span>
                          </TableCell>
                          <TableCell className="bg-background">{currentMeta.post_type}</TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">toggle_on</span>
                              Status
                            </span>
                          </TableCell>
                          <TableCell className="bg-background">{currentMeta.status}</TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">folder</span>
                              Categories
                            </span>
                          </TableCell>
                          <TableCell className="bg-background">
                            {currentMeta.categories.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {currentMeta.categories.map(cat => (
                                  <Badge key={cat} variant="outline" className="text-xs font-normal">
                                    {cat}
                                    <button
                                      className="ml-1 hover:text-foreground"
                                      onClick={() => setPermissionsOpen(true)}
                                    >
                                      &times;
                                    </button>
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">None</span>
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">sell</span>
                              Tags
                            </span>
                          </TableCell>
                          <TableCell className="bg-background">
                            {currentMeta.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {currentMeta.tags.map(tag => (
                                  <Badge key={tag} variant="outline" className="text-xs font-normal">
                                    {tag}
                                    <button
                                      className="ml-1 hover:text-foreground"
                                      onClick={() => setPermissionsOpen(true)}
                                    >
                                      &times;
                                    </button>
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">None</span>
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">arrow_outward</span>
                              Links Out
                            </span>
                          </TableCell>
                          <TableCell className="bg-background">
                            {(linksOut[currentMeta.id] || []).length || 'Zero'}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-0">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">arrow_insert</span>
                              Links In
                            </span>
                          </TableCell>
                          <TableCell className="bg-background">
                            <span className="flex items-center">
                              {(linksIn[currentMeta.id] || []).length || 'Zero'}
                              <a
                                href={getAiLinkUrl()}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1.5 inline-flex"
                                title="Get AI suggestions for internal links"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M32.4473 0C33.1278 0 33.7197 0.46478 33.8857 1.125C34.3947 3.1444 35.0586 5.1141 35.8848 7.0303C38.0369 12.0299 40.99 16.406 44.7393 20.1553C48.4903 23.9045 52.8647 26.8576 57.8643 29.0098C59.7821 29.8359 61.7502 30.4998 63.7695 31.0088C64.4297 31.1748 64.8944 31.7668 64.8945 32.4473C64.8945 33.1278 64.4298 33.7198 63.7695 33.8857C61.7502 34.3947 59.7803 35.0586 57.8643 35.8848C52.8646 38.037 48.4885 40.99 44.7393 44.7393C40.99 48.4904 38.037 52.8646 35.8848 57.8643C35.0586 59.7822 34.3947 61.7502 33.8857 63.7695C33.7198 64.4298 33.1278 64.8945 32.4473 64.8945C31.7668 64.8944 31.1748 64.4297 31.0088 63.7695C30.4998 61.7502 29.8359 59.7803 29.0098 57.8643C26.8576 52.8647 23.9063 48.4885 20.1553 44.7393C16.4041 40.99 12.0299 38.0369 7.0303 35.8848C5.1123 35.0586 3.1444 34.3947 1.125 33.8857C0.46478 33.7197 0 33.1278 0 32.4473C8.6765e-05 31.7668 0.46483 31.1748 1.125 31.0088C3.1444 30.4998 5.1141 29.836 7.0303 29.0098C12.03 26.8575 16.406 23.9046 20.1553 20.1553C23.9046 16.406 26.8575 12.03 29.0098 7.0303C29.836 5.1123 30.4998 3.1445 31.0088 1.125C31.1748 0.46483 31.7668 0.0001 32.4473 0Z" fill="url(#paint0_linear_ai_sparkle)"/>
                                  <defs>
                                    <linearGradient id="paint0_linear_ai_sparkle" x1="18.4473" y1="43.42" x2="52.1533" y2="15.004" gradientUnits="userSpaceOnUse">
                                      <stop stopColor="#4893FC"/>
                                      <stop offset="0.27" stopColor="#4893FC"/>
                                      <stop offset="0.77698" stopColor="#969DFF"/>
                                      <stop offset="1" stopColor="#BD99FE"/>
                                    </linearGradient>
                                  </defs>
                                </svg>
                              </a>
                            </span>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  {/* GA Performance Section */}
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-6 mb-3">
                    GA Performance
                  </h4>
                  <div className="rounded-lg overflow-hidden bg-muted/50">
                    <Table>
                      <TableBody>
                        <TableRow className="border-muted">
                          <TableCell className="w-28 text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">browse_activity</span>
                              Sessions
                            </span>
                          </TableCell>
                          <TableCell className="bg-background tabular-nums">{sessions.toLocaleString()}</TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">group</span>
                              Active Users
                            </span>
                          </TableCell>
                          <TableCell className="bg-background tabular-nums">{(currentTraffic.active_users || 0).toLocaleString()}</TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">person_add</span>
                              New Users
                            </span>
                          </TableCell>
                          <TableCell className="bg-background tabular-nums">{(currentTraffic.new_users || 0).toLocaleString()}</TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">timer</span>
                              Avg Time
                            </span>
                          </TableCell>
                          <TableCell className="bg-background tabular-nums">
                            {currentTraffic.avg_engagement_time ? `${currentTraffic.avg_engagement_time}s` : '—'}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-0">
                          <TableCell className="text-muted-foreground bg-transparent">
                            <span className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-sm opacity-60">conversion_path</span>
                              Key Events
                            </span>
                          </TableCell>
                          <TableCell className="bg-background tabular-nums">{(currentTraffic.key_events || 0).toLocaleString()}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-5 mt-auto border-t shrink-0">
                  <Button
                    variant="secondary"
                    onClick={unpublish}
                    className="flex-1"
                  >
                    Unpublish <kbd className="ml-2 text-[11px] bg-black/8 px-1.5 py-0.5 rounded uppercase">esc</kbd>
                  </Button>
                  <Button
                    onClick={keep}
                    className="flex-1"
                  >
                    Keep <kbd className="ml-2 text-[11px] bg-white/20 px-1.5 py-0.5 rounded uppercase">space</kbd>
                  </Button>
                </div>
              </div>

              {/* Preview Panel */}
              <div className="flex-1 min-w-0 overflow-hidden bg-background p-4">
                <div
                  className="h-[calc(100%-48px)] rounded-2xl flex flex-col p-6 overflow-hidden relative group"
                  style={{
                    background: '#f5f5f4 radial-gradient(circle, #ddd 1px, transparent 1px)',
                    backgroundSize: '16px 16px',
                    boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.06)'
                  }}
                >
                  {/* Preview Container */}
                  <div
                    className={cn(
                      "flex-1 min-h-0 bg-white rounded-lg overflow-auto relative transition-all duration-300",
                      "shadow-[0_1px_3px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.08)]",
                      isMobileView && "w-60 max-w-60"
                    )}
                  >
                    <div
                      className={cn(
                        "origin-top-left",
                        isMobileView ? "w-[166.67%] scale-[0.6]" : "w-[333.33%] scale-[0.3]"
                      )}
                    >
                      <iframe
                        src={`${currentMeta.permalink}${currentMeta.permalink.includes('?') ? '&' : '?'}preview=true`}
                        className="w-full h-[2000px] border-0 bg-white block"
                        sandbox="allow-same-origin allow-scripts"
                      />
                    </div>
                  </div>

                  {/* Preview Actions */}
                  <div className="shrink-0 flex gap-2.5 pt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button asChild className="flex-1">
                      <a href={currentMeta.permalink} target="_blank" rel="noopener noreferrer">
                        Live
                      </a>
                    </Button>
                    <Button asChild className="flex-1">
                      <a href={currentMeta.edit_link} target="_blank" rel="noopener noreferrer">
                        Edit
                      </a>
                    </Button>
                    <Button onClick={() => setIsMobileView(!isMobileView)} className="flex-1">
                      {isMobileView ? 'Desktop' : 'Mobile'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Footer */}
      <footer className="flex justify-between items-center py-4 mt-4 border-t">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-sm">WP Triage</span>
          <button
            onClick={() => setPermissionsOpen(true)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Permissions
          </button>
        </div>
        <nav className="flex gap-6">
          <a href="https://wims.vc" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground">
            Made by wims.vc
          </a>
          <a href="https://wims.vc/contact" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground">
            Inquire
          </a>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground">
            Support
          </a>
        </nav>
      </footer>

      {/* Permissions Modal */}
      <Dialog open={permissionsOpen} onOpenChange={setPermissionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permissions</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <Label className="flex items-center gap-3 cursor-pointer">
                <Checkbox defaultChecked />
                <span>Mark posts as "draft"</span>
              </Label>
              <Badge variant="success" className="text-xs">Non destructive</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="flex items-center gap-3 cursor-pointer">
                <Checkbox />
                <span>Make new tracking post meta</span>
              </Label>
              <Badge variant="success" className="text-xs">Non destructive</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="flex items-center gap-3 cursor-pointer">
                <Checkbox />
                <span>Edit tags/categories/taxonomies</span>
              </Label>
              <Badge variant="warning" className="text-xs">Metadata edit rights</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="flex items-center gap-3 cursor-pointer">
                <Checkbox />
                <span>Actually delete posts</span>
              </Label>
              <Badge variant="destructive" className="text-xs">Destructive, with confirm</Badge>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setPermissionsOpen(false)}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Actions Modal */}
      <Dialog open={bulkActionsOpen} onOpenChange={setBulkActionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Actions</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {selected.size} item{selected.size !== 1 ? 's' : ''} selected
            </p>
          </div>
          <DialogFooter className="flex gap-2.5">
            <Button variant="secondary" onClick={bulkUnpublish} className="flex-1">
              Unpublish All
            </Button>
            <Button onClick={bulkKeep} className="flex-1">
              Keep All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
