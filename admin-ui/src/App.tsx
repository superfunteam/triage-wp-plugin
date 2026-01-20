import { useState, useEffect, useCallback, useRef } from 'react'
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge } from '@/components/ui/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import './index.css'

// Types
interface PostType {
  name: string
  label: string
  count: number
  triaged: number
}

interface Post {
  id: number
  title: string
  status: string
  triage_status: 'keep' | 'unpublish' | null
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

// Dynamic traffic data - keys come from CSV headers
type TrafficData = Record<string, string | number>

interface TrafficResponse {
  headers: string[]
  data: Record<string, TrafficData>
}

declare global {
  interface Window {
    wpTriage: {
      ajaxUrl: string
      nonce: string
    }
  }
}

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
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [linksOut, setLinksOut] = useState<Record<number, number[]>>({})
  const [linksIn, setLinksIn] = useState<Record<number, number[]>>({})
  const [traffic, setTraffic] = useState<Record<string, TrafficData>>({})
  const [trafficHeaders, setTrafficHeaders] = useState<string[]>([])
  const [isMobileView, setIsMobileView] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showPostsPanel, setShowPostsPanel] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false)
  const [csvUploadOpen, setCsvUploadOpen] = useState(false)
  const [csvFilename, setCsvFilename] = useState<string | null>(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvSuccess, setCsvSuccess] = useState(false)
  const [unpublishedSlugs, setUnpublishedSlugs] = useState<Set<string>>(new Set())
  const [rawCsvLines, setRawCsvLines] = useState<string[]>([])
  const csvInputRef = useRef<HTMLInputElement>(null)

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

  // Load post metadata
  const loadPost = useCallback((postId: number) => {
    ajax<PostMeta>('wp_triage_get_post_meta', { post_id: postId }).then(res => {
      if (!res.success) return
      setCurrentMeta(res.data)
    })
  }, [])

  // Find and load next untriaged post
  const findNextPost = useCallback((postList: Post[], fromIndex: number) => {
    for (let i = fromIndex + 1; i < postList.length; i++) {
      if (postList[i].triage_status === null) {
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
      // Find first untriaged post
      for (let i = 0; i < res.data.length; i++) {
        if (res.data[i].triage_status === null) {
          setCurrentIndex(i)
          loadPost(res.data[i].id)
          return
        }
      }
      // All triaged - select first post anyway
      if (res.data.length > 0) {
        setCurrentIndex(0)
        loadPost(res.data[0].id)
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

    ajax<TrafficResponse & { filename?: string; raw_lines?: string[] }>('wp_triage_get_traffic').then(res => {
      if (!res.success) return
      setTrafficHeaders(res.data.headers)
      setTraffic(res.data.data)
      if (res.data.raw_lines) {
        setRawCsvLines(res.data.raw_lines)
      }
      if (res.data.filename) {
        setCsvFilename(res.data.filename)
        // Load unpublished slugs for CSV export
        ajax<string[]>('wp_triage_get_unpublished_slugs').then(slugRes => {
          if (slugRes.success) {
            setUnpublishedSlugs(new Set(slugRes.data))
          }
        })
      }
    })
  }, [selectType])

  // Update URL when state changes
  useEffect(() => {
    updateURL()
  }, [currentType, currentIndex, updateURL])

  // Go to next post
  const nextPost = useCallback(() => {
    const found = findNextPost(posts, currentIndex)
    if (!found) {
      // Move to next post type
      const nextTypeIndex = postTypes.findIndex(t => t.name === currentType) + 1
      if (nextTypeIndex < postTypes.length) {
        selectType(postTypes[nextTypeIndex].name)
      } else {
        setCurrentMeta(null) // Show done state
      }
    }
  }, [posts, currentIndex, postTypes, currentType, findNextPost, selectType])

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

    const wasUntriaged = post.triage_status === null
    const slug = currentMeta ? getSlugFromPermalink(currentMeta.permalink) : null

    // Mark as triaged AND unpublish
    Promise.all([
      ajax<{ post_id: number; triage_status: string }>('wp_triage_mark', { post_id: post.id, status: 'unpublish' }),
      ajax<{ id: number; status: string }>('wp_triage_unpublish', { post_id: post.id })
    ]).then(([markRes, unpubRes]) => {
      if (!markRes.success || !unpubRes.success) return
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'draft', triage_status: 'unpublish' } : p))
      // Track unpublished slug for CSV export
      if (slug) {
        setUnpublishedSlugs(prev => new Set([...prev, slug]))
      }
      // Update postTypes triaged count if this was previously untriaged
      if (wasUntriaged && currentType) {
        setPostTypes(prev => prev.map(t => t.name === currentType ? { ...t, triaged: t.triaged + 1 } : t))
      }
      nextPost()
    })
  }, [posts, currentIndex, nextPost, currentType, currentMeta])

  // Keep current post
  const keep = useCallback(() => {
    const post = posts[currentIndex]
    if (!post) return

    const wasUntriaged = post.triage_status === null

    ajax<{ post_id: number; triage_status: string }>('wp_triage_mark', { post_id: post.id, status: 'keep' }).then(res => {
      if (!res.success) return
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, triage_status: 'keep' } : p))
      // Update postTypes triaged count if this was previously untriaged
      if (wasUntriaged && currentType) {
        setPostTypes(prev => prev.map(t => t.name === currentType ? { ...t, triaged: t.triaged + 1 } : t))
      }
      nextPost()
    })
  }, [posts, currentIndex, nextPost, currentType])

  // Bulk unpublish
  const bulkUnpublish = () => {
    const selectedIds = [...selected]
    // Count how many were previously untriaged
    const newlyTriagedCount = selectedIds.filter(id => {
      const post = posts.find(p => p.id === id)
      return post && post.triage_status === null
    }).length

    let completed = 0

    selectedIds.forEach(postId => {
      Promise.all([
        ajax<{ post_id: number; triage_status: string }>('wp_triage_mark', { post_id: postId, status: 'unpublish' }),
        ajax<{ id: number; status: string }>('wp_triage_unpublish', { post_id: postId })
      ]).then(([markRes, unpubRes]) => {
        if (markRes.success && unpubRes.success) {
          setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: 'draft', triage_status: 'unpublish' } : p))
        }
        completed++
        if (completed === selectedIds.length) {
          // Update postTypes triaged count
          if (newlyTriagedCount > 0 && currentType) {
            setPostTypes(prev => prev.map(t => t.name === currentType ? { ...t, triaged: t.triaged + newlyTriagedCount } : t))
          }
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
    // Count how many were previously untriaged
    const newlyTriagedCount = selectedIds.filter(id => {
      const post = posts.find(p => p.id === id)
      return post && post.triage_status === null
    }).length

    let completed = 0

    selectedIds.forEach(postId => {
      ajax<{ post_id: number; triage_status: string }>('wp_triage_mark', { post_id: postId, status: 'keep' }).then(res => {
        if (res.success) {
          setPosts(prev => prev.map(p => p.id === postId ? { ...p, triage_status: 'keep' } : p))
        }
        completed++
        if (completed === selectedIds.length) {
          // Update postTypes triaged count
          if (newlyTriagedCount > 0 && currentType) {
            setPostTypes(prev => prev.map(t => t.name === currentType ? { ...t, triaged: t.triaged + newlyTriagedCount } : t))
          }
          setSelected(new Set())
          setBulkActionsOpen(false)
          nextPost()
        }
      })
    })
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

      // Escape to close modals
      if (e.key === 'Escape') {
        if (bulkActionsOpen) {
          setBulkActionsOpen(false)
          return
        }
        if (permissionsOpen) {
          setPermissionsOpen(false)
          return
        }
        return
      }

      // Delete to unpublish
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
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
      if (e.key === 'u') unpublish()
      if (e.key === 'k') keep()

      // Left arrow goes back to post types
      if (e.key === 'ArrowLeft') {
        if (showPostsPanel) {
          goBackToTypes()
        }
        return
      }

      // Right arrow goes to next post type's posts
      if (e.key === 'ArrowRight') {
        if (!showPostsPanel && postTypes.length > 0) {
          // If on types view, select first type
          selectType(postTypes[0].name)
        } else if (showPostsPanel) {
          // If on posts view, go to next post type directly (no slide animation)
          const currentTypeIndex = postTypes.findIndex(t => t.name === currentType)
          const nextTypeIndex = currentTypeIndex + 1
          if (nextTypeIndex < postTypes.length) {
            selectType(postTypes[nextTypeIndex].name)
          }
        }
        return
      }

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
  }, [unpublish, keep, posts, currentIndex, bulkActionsOpen, permissionsOpen, loadPost, showPostsPanel, postTypes, currentType, selectType])

  // Get traffic data for current post
  const currentTraffic = currentMeta ? traffic[getSlugFromPermalink(currentMeta.permalink)] || {} : {}
  // Try to get sessions from first numeric column for badges
  const firstNumericValue = trafficHeaders.length > 0
    ? (typeof currentTraffic[trafficHeaders[0]] === 'number' ? currentTraffic[trafficHeaders[0]] as number : 0)
    : 0
  const slug = currentMeta ? getSlugFromPermalink(currentMeta.permalink) : ''
  const isTopLevel = slug && slug !== '/' && !slug.includes('/')

  // Remaining counts (posts without triage status)
  const remainingInType = posts.filter(p => p.triage_status === null).length

  // Total counts across all post types
  const totalPosts = postTypes.reduce((sum, t) => sum + t.count, 0)
  const totalTriaged = postTypes.reduce((sum, t) => sum + t.triaged, 0)

  // Format count as "triaged/total" or just "total" if no triaged yet
  const formatCount = (triaged: number, total: number) => {
    if (triaged === 0) return total.toLocaleString()
    return `${triaged.toLocaleString()}/${total.toLocaleString()}`
  }

  // Sort posts for display: untriaged first, then triaged (preserving original indices)
  const sortedPosts = posts
    .map((post, index) => ({ post, originalIndex: index }))
    .sort((a, b) => {
      const aTriaged = a.post.triage_status !== null ? 1 : 0
      const bTriaged = b.post.triage_status !== null ? 1 : 0
      return aTriaged - bTriaged
    })

  // AI link helper URL
  const getAiLinkUrl = () => {
    if (!currentMeta) return '#'
    const productionPermalink = currentMeta.permalink.replace(/^https?:\/\/[^\/]+/, 'https://sourceday.com')
    const aiPrompt = `The content at ${productionPermalink} is valuable and needs more internal links pointing to it. Analyze my site and find THREE existing pages or posts that should link TO this content. For each, explain where the link should be placed and what anchor text to use.`
    return `https://chatgpt.com/g/g-692755ed9bf0819182ad27cedf7d22d2?prompt=${encodeURIComponent(aiPrompt)}`
  }

  return (
    <div className="flex flex-col h-[calc(100vh-70px)] mr-5 mt-5 mb-5 font-sans">
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Sidebar */}
        <Sidebar className="w-60 flex-shrink-0 bg-transparent border-none">
          <SidebarContent className="overflow-hidden h-full">
            <div className="flex w-[200%] h-full transition-transform duration-300" style={{ transform: showPostsPanel ? 'translateX(-50%)' : 'translateX(0)' }}>
              {/* Post Types Panel */}
              <div className="w-1/2 p-0 h-full overflow-y-auto">
                <SidebarHeader className="px-0 pt-0">
                  <div className="flex items-center justify-between text-sm font-semibold text-foreground">
                    <span>All Post Types</span>
                    <Badge variant="muted" className="text-xs">{formatCount(totalTriaged, totalPosts)}</Badge>
                  </div>
                  <div className="pr-3 mt-2">
                    <Progress
                      value={totalPosts > 0 ? (totalTriaged / totalPosts) * 100 : 0}
                      className="h-1"
                    />
                  </div>
                </SidebarHeader>
                <SidebarMenu className="px-0">
                  {postTypes.map(type => (
                    <SidebarMenuItem key={type.name}>
                      <SidebarMenuButton
                        isActive={currentType === type.name}
                        onClick={() => selectType(type.name)}
                        className={cn(
                          "flex-col items-stretch gap-1.5 py-2 pl-0 pr-3",
                          currentType === type.name && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                        )}
                      >
                        <span className="flex items-center justify-between w-full">
                          <span>{type.label}</span>
                          <SidebarMenuBadge className={cn(
                            currentType === type.name && "text-white/70"
                          )}>
                            {formatCount(type.triaged, type.count)}
                          </SidebarMenuBadge>
                        </span>
                        <Progress
                          value={type.count > 0 ? (type.triaged / type.count) * 100 : 0}
                          className={cn(
                            "h-0.5",
                            currentType === type.name && "[&>div]:bg-white/50"
                          )}
                        />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </div>

              {/* Posts Panel */}
              <div className="w-1/2 flex flex-col h-full overflow-hidden">
                {/* Fixed Header */}
                <div className="shrink-0">
                  {/* Back Button */}
                  <Button
                    variant="secondary"
                    onClick={goBackToTypes}
                    className="w-full justify-between mb-3 rounded-2xl"
                  >
                    <span>&larr; All Types</span>
                    <span className="text-xs text-muted-foreground">{formatCount(totalTriaged, totalPosts)}</span>
                  </Button>

                  {/* Posts Header */}
                  <div className="flex items-center justify-between text-sm font-semibold text-foreground mb-3">
                    <span>{postTypes.find(t => t.name === currentType)?.label || ''}</span>
                    <Badge variant="muted" className="text-xs min-w-[54px] text-center">{formatCount(posts.length - remainingInType, posts.length)}</Badge>
                  </div>
                </div>

                {/* Scrollable Posts List */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  <div className="space-y-0.5">
                    {isLoading ? (
                      <div className="text-sm text-muted-foreground py-2 px-3">Loading...</div>
                    ) : (
                      sortedPosts.map(({ post, originalIndex }) => (
                        <button
                          key={post.id}
                          onClick={() => {
                            setCurrentIndex(originalIndex)
                            loadPost(post.id)
                          }}
                          className={cn(
                            "w-full text-left flex items-center gap-1.5 py-2 px-2.5 text-sm rounded-md transition-colors",
                            originalIndex === currentIndex
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-accent",
                            post.triage_status !== null && "opacity-40 line-through"
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
                                originalIndex === currentIndex && "border-white/60 data-[state=checked]:bg-transparent data-[state=checked]:border-white"
                              )}
                            />
                          </label>
                          <span className="flex-1 min-w-0 truncate">{post.title}</span>
                          {post.triage_status && (
                            <span className={cn(
                              "shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium leading-none",
                              post.triage_status === 'keep'
                                ? "bg-green-500/15 text-green-600 border border-green-500/30"
                                : "bg-orange-500/15 text-orange-600 border border-orange-500/30",
                              originalIndex === currentIndex && "bg-white/20 text-white border-0"
                            )}>
                              {post.triage_status === 'keep' ? 'Kept' : 'Unpub'}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Fixed Bulk Actions */}
                {selected.size > 0 && (
                  <div className="shrink-0 pt-4 pb-6 border-t">
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
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
              <svg
                className="w-16 h-16 opacity-40 animate-hover"
                viewBox="0 0 100 100"
                fill="currentColor"
              >
                <g>
                  <path d="m50 37.699c-20.199 0-42 5.3008-42 17.102v25.602c0 11.801 21.801 17.102 42 17.102s42-5.3984 42-17.102v-25.602c0-11.801-21.801-17.102-42-17.102zm0 8.6016c21.898 0 33.398 6.3008 33.398 8.5s-11.5 8.5-33.398 8.5-33.398-6.3008-33.398-8.5 11.5-8.5 33.398-8.5z"/>
                  <path d="m50 27.199c2.3984 0 4.3008-1.8984 4.3008-4.3008v-16c0-2.3984-1.8984-4.3008-4.3008-4.3008-2.3984 0-4.3008 1.8984-4.3008 4.3008v16c0 2.3008 1.9023 4.3008 4.3008 4.3008z"/>
                  <path d="m27.102 28.199c0.69922 1.6992 2.3008 2.6992 4 2.6992 0.60156 0 1.1016-0.10156 1.6992-0.30078 2.1992-0.89844 3.1992-3.3984 2.3008-5.6016l-6.1016-14.996c-0.89844-2.1992-3.3984-3.1992-5.6016-2.3008-2.1992 0.89844-3.1992 3.3984-2.3008 5.6016z"/>
                  <path d="m67.199 30.602c0.5 0.19922 1.1016 0.30078 1.6016 0.30078 1.6992 0 3.3008-1 4-2.6992l6.1992-14.703c0.89844-2.1992-0.10156-4.6992-2.3008-5.6016-2.1992-1-4.8008 0.10156-5.6992 2.3008l-6.1016 14.801c-0.89844 2.1992 0.10156 4.6992 2.3008 5.6016z"/>
                </g>
              </svg>
              <span className="text-sm">Select a post type to begin</span>
            </div>
          )}

          {!currentMeta && currentType && posts.length > 0 && !isLoading && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              All done! No more posts to review.
            </div>
          )}

          {currentMeta && (
            <div className="flex flex-1 h-full">
              {/* Left Meta Column */}
              <div className="w-[340px] shrink-0 p-6 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto min-h-0">
                  {/* Badges */}
                  <div className="mb-1 flex gap-1.5 flex-wrap">
                    {posts.find(p => p.id === currentMeta.id)?.triage_status === 'keep' && (
                      <Badge variant="success" className="text-xs">Kept</Badge>
                    )}
                    {posts.find(p => p.id === currentMeta.id)?.triage_status === 'unpublish' && (
                      <Badge variant="outline" className="text-xs">Unpublished</Badge>
                    )}
                    {firstNumericValue >= 75 && (
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
                  <div className="rounded-lg overflow-hidden bg-muted/50 border border-border/50">
                    <Table>
                      <TableBody>
                        <TableRow className="border-muted">
                          <TableCell className="w-28 text-muted-foreground bg-transparent text-xs">
                            Post Type
                          </TableCell>
                          <TableCell className="bg-background">{currentMeta.post_type}</TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent text-xs">
                            Status
                          </TableCell>
                          <TableCell className="bg-background">{currentMeta.status}</TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent text-xs">
                            Categories
                          </TableCell>
                          <TableCell className="bg-background">
                            <div className="flex flex-wrap items-center gap-1">
                              {currentMeta.categories.map(cat => (
                                <Badge key={cat} variant="outline" className="text-xs font-normal py-0.5 px-1.5 flex items-center gap-0.5">
                                  <span className="truncate">{cat}</span>
                                  <button
                                    className="shrink-0 opacity-50 hover:opacity-100"
                                    onClick={() => setPermissionsOpen(true)}
                                  >
                                    &times;
                                  </button>
                                </Badge>
                              ))}
                              <button
                                className="w-5 h-5 flex items-center justify-center text-xs border border-dashed border-muted-foreground/30 rounded text-muted-foreground hover:border-foreground hover:text-foreground transition-colors shrink-0"
                                onClick={() => setPermissionsOpen(true)}
                                title="Add category"
                              >
                                +
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent text-xs">
                            Tags
                          </TableCell>
                          <TableCell className="bg-background">
                            <div className="flex flex-wrap items-center gap-1">
                              {currentMeta.tags.map(tag => (
                                <Badge key={tag} variant="outline" className="text-xs font-normal py-0.5 px-1.5 flex items-center gap-0.5">
                                  <span className="truncate">{tag}</span>
                                  <button
                                    className="shrink-0 opacity-50 hover:opacity-100"
                                    onClick={() => setPermissionsOpen(true)}
                                  >
                                    &times;
                                  </button>
                                </Badge>
                              ))}
                              <button
                                className="w-5 h-5 flex items-center justify-center text-xs border border-dashed border-muted-foreground/30 rounded text-muted-foreground hover:border-foreground hover:text-foreground transition-colors shrink-0"
                                onClick={() => setPermissionsOpen(true)}
                                title="Add tag"
                              >
                                +
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-muted">
                          <TableCell className="text-muted-foreground bg-transparent text-xs">
                            Links Out
                          </TableCell>
                          <TableCell className="bg-background">
                            {(linksOut[currentMeta.id] || []).length || 'Zero'}
                          </TableCell>
                        </TableRow>
                        <TableRow className="border-0">
                          <TableCell className="text-muted-foreground bg-transparent text-xs">
                            Links In
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

                  {/* Your CSV Data Section - Dynamic columns from traffic.csv */}
                  {trafficHeaders.length > 0 && (
                    <>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-6 mb-2">
                        Your CSV Data
                      </h4>
                      <div className="rounded-lg overflow-hidden bg-muted/50 border border-border/50">
                        <Table>
                          <TableBody>
                            {trafficHeaders.map((header, index) => {
                              const value = currentTraffic[header]
                              const displayValue = typeof value === 'number'
                                ? value.toLocaleString()
                                : value || '—'
                              return (
                                <TableRow key={header} className={index === trafficHeaders.length - 1 ? "border-0" : "border-muted"}>
                                  <TableCell className="w-28 text-muted-foreground bg-transparent text-xs">
                                    {header}
                                  </TableCell>
                                  <TableCell className="bg-background tabular-nums">{displayValue}</TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-5 mt-auto border-t shrink-0">
                  <Button
                    variant="outline"
                    onClick={unpublish}
                    className="flex-1 group/unpub hover:bg-red-500 hover:text-white hover:border-red-500 pr-1.5"
                  >
                    <span className="flex-1 text-center">Unpublish</span>
                    <kbd className="shrink-0 border border-black/15 border-b-black/30 group-hover/unpub:border-white/30 group-hover/unpub:border-b-white/50 px-1.5 py-0.5 rounded font-medium tracking-wide shadow-[0_1px_0_rgba(0,0,0,0.1)] group-hover/unpub:shadow-[0_1px_0_rgba(255,255,255,0.2)]" style={{ fontSize: '10px', background: 'transparent' }}>DEL</kbd>
                  </Button>
                  <Button
                    onClick={keep}
                    className="flex-1 hover:bg-green-600 pr-1.5"
                  >
                    <span className="flex-1 text-center">Keep</span>
                    <kbd className="shrink-0 border border-white/20 border-b-white/40 px-1.5 py-0.5 rounded font-medium tracking-wide shadow-[0_1px_0_rgba(255,255,255,0.15)]" style={{ fontSize: '10px', background: 'transparent' }}>SPACE</kbd>
                  </Button>
                </div>
              </div>

              {/* Preview Panel */}
              <div className="flex-1 min-w-0 overflow-hidden bg-background pt-4 pl-4 pr-4 flex flex-col">
                <div
                  className="flex-1 min-h-0 rounded-t-2xl overflow-hidden relative group border border-b-0 border-gray-200"
                  style={isMobileView ? {
                    background: '#f5f5f4 radial-gradient(circle, #ddd 1px, transparent 1px)',
                    backgroundSize: '16px 16px',
                    boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.06)'
                  } : undefined}
                >
                  {/* White backer - only for mobile view */}
                  {isMobileView && (
                    <div className="absolute inset-0 pt-6 px-6 flex justify-center transition-all duration-300 ease-in-out pointer-events-none">
                      <div className="h-full bg-white rounded-t-lg w-80" />
                    </div>
                  )}

                  {/* Preview Container Wrapper */}
                  <div className={cn(
                    "absolute inset-0 flex transition-all duration-300 ease-in-out",
                    isMobileView ? "pt-6 px-6 justify-center" : ""
                  )}>
                    {/* Preview Container */}
                    <div
                      className={cn(
                        "h-full bg-white overflow-auto relative transition-all duration-300 ease-in-out",
                        "group-hover:opacity-30",
                        isMobileView
                          ? "w-80 rounded-t-lg shadow-[0_1px_3px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.08)]"
                          : "w-full rounded-t-2xl"
                      )}
                    >
                      <div
                        className={cn(
                          "origin-top-left transition-all duration-300 ease-in-out",
                          isMobileView ? "w-[125%] scale-[0.8]" : "w-[333.33%] scale-[0.3]"
                        )}
                      >
                        <iframe
                          src={`${currentMeta.permalink}${currentMeta.permalink.includes('?') ? '&' : '?'}preview=true`}
                          className="w-full h-[5000px] border-0 bg-white block"
                          sandbox="allow-same-origin allow-scripts"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Preview Actions - overlay at bottom, shown on hover */}
                  <div className="absolute bottom-6 left-6 right-6 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <Button asChild className="flex-1 text-white">
                      <a href={currentMeta.permalink} target="_blank" rel="noopener noreferrer" className="text-white no-underline">
                        Live
                      </a>
                    </Button>
                    <Button asChild className="flex-1 text-white">
                      <a href={currentMeta.edit_link} target="_blank" rel="noopener noreferrer" className="text-white no-underline">
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
      <footer className="flex justify-between items-center shrink-0 pt-6">
        <div className="flex items-center gap-4">
          <span className="font-semibold text-sm">Triage WP</span>
          <button
            onClick={() => setPermissionsOpen(true)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Permissions
          </button>
          <button
            onClick={() => {
              setCsvSuccess(false)
              setCsvUploadOpen(true)
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            CSV
          </button>
        </div>
        <nav className="flex gap-4">
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
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Permissions</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <Label className="flex items-center gap-3 cursor-pointer">
                <Checkbox defaultChecked />
                <span>Make new Triage meta data</span>
              </Label>
              <Badge variant="success" className="text-xs">Totally safe</Badge>
            </div>
            <div className="flex items-center justify-between gap-3 opacity-50">
              <Label className="flex items-center gap-3">
                <Checkbox disabled />
                <span>Edit content tags/categories/taxonomies</span>
              </Label>
              <Badge variant="warning" className="text-xs">Requires permission</Badge>
            </div>
            <div className="flex items-center justify-between gap-3 opacity-50">
              <Label className="flex items-center gap-3">
                <Checkbox disabled />
                <span>Mark content as "Draft" status</span>
              </Label>
              <Badge variant="warning" className="text-xs">Requires permission</Badge>
            </div>
            <div className="flex items-center justify-between gap-3 opacity-50">
              <Label className="flex items-center gap-3">
                <Checkbox disabled />
                <span>Actually delete posts</span>
              </Label>
              <Badge variant="destructive" className="text-xs">Destructive, Requires permission</Badge>
            </div>
            <div className="pt-4 border-t mt-4">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to clear ALL triage data? This will remove all triage status from posts and delete any uploaded CSV data. This cannot be undone.')) {
                    ajax('wp_triage_clear_all_data').then(res => {
                      if (res.success) {
                        alert('All triage data cleared. The page will now reload.')
                        window.location.reload()
                      } else {
                        alert('Failed to clear data: ' + (res.data || 'Unknown error'))
                      }
                    })
                  }
                }}
                className="text-sm text-destructive hover:underline"
              >
                Clear all Triage data
              </button>
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

      {/* CSV Upload Modal */}
      <Dialog open={csvUploadOpen} onOpenChange={setCsvUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload CSV</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {csvSuccess ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <span className="material-symbols-outlined text-green-600">check</span>
                </div>
                <p className="font-medium text-foreground mb-1">CSV uploaded successfully</p>
                <p className="text-sm text-muted-foreground">{csvFilename}</p>
              </div>
            ) : (
              <>
                {csvFilename ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      <span className="material-symbols-outlined text-muted-foreground text-lg">description</span>
                      <span className="text-sm flex-1 truncate">{csvFilename}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Download the CSV with strikethrough on URLs marked for unpublishing, or upload a replacement.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          // Check if raw CSV data is available
                          if (!rawCsvLines || rawCsvLines.length === 0) {
                            alert('Please re-upload your CSV file to enable download with strikethrough markup.')
                            return
                          }

                          // Fetch fresh unpublished slugs then generate CSV from raw lines
                          ajax<string[]>('wp_triage_get_unpublished_slugs').then(res => {
                            const currentUnpublished = res.success ? new Set(res.data) : unpublishedSlugs

                            // Helper to parse CSV line respecting quotes
                            const parseCSVLine = (line: string) => {
                              const result: string[] = []
                              let current = ''
                              let inQuotes = false
                              for (let i = 0; i < line.length; i++) {
                                const char = line[i]
                                if (char === '"') {
                                  inQuotes = !inQuotes
                                  current += char
                                } else if (char === ',' && !inQuotes) {
                                  result.push(current)
                                  current = ''
                                } else {
                                  current += char
                                }
                              }
                              result.push(current)
                              return result
                            }

                            // Process raw CSV lines, only modifying column A
                            const outputLines = rawCsvLines.map((line, index) => {
                              if (index === 0) return line // Keep header unchanged

                              const columns = parseCSVLine(line)
                              if (columns.length === 0) return line

                              // Get the original slug value and normalize for lookup
                              const originalSlug = columns[0]
                              // Strip surrounding quotes if present, then strip leading/trailing slashes
                              const cleanSlug = originalSlug.replace(/^"(.*)"$/, '$1')
                              const normalizedSlug = cleanSlug.replace(/^\/|\/$/g, '')
                              // Empty stays empty - don't convert to '/'

                              // Check if this slug is unpublished (skip empty slugs)
                              if (normalizedSlug && currentUnpublished.has(normalizedSlug)) {
                                columns[0] = `[UNPUBLISH] ${originalSlug}`
                              }

                              return columns.join(',')
                            })

                            const csvContent = outputLines.join('\n')
                            const blob = new Blob([csvContent], { type: 'text/csv' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = csvFilename?.replace('.csv', '-triaged.csv') || 'triaged.csv'
                            a.click()
                            URL.revokeObjectURL(url)
                          })
                        }}
                        className="flex-1"
                      >
                        Download CSV
                      </Button>
                      <Button
                        onClick={() => csvInputRef.current?.click()}
                        className="flex-1"
                        disabled={csvUploading}
                      >
                        {csvUploading ? 'Processing...' : 'Replace CSV'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-4">
                      Upload a CSV file with URL slugs in the first column. Additional columns will be displayed as metadata for each post.
                    </p>
                    <Button
                      onClick={() => csvInputRef.current?.click()}
                      className="w-full"
                      disabled={csvUploading}
                    >
                      {csvUploading ? 'Processing...' : 'Choose CSV File'}
                    </Button>
                  </>
                )}
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return

                    setCsvUploading(true)
                    const reader = new FileReader()
                    reader.onload = (event) => {
                      const text = event.target?.result as string
                      const lines = text.split('\n').filter(line => line.trim())
                      if (lines.length < 2) {
                        setCsvUploading(false)
                        return
                      }

                      // Parse CSV
                      const parseCSVLine = (line: string) => {
                        const result: string[] = []
                        let current = ''
                        let inQuotes = false
                        for (let i = 0; i < line.length; i++) {
                          const char = line[i]
                          if (char === '"') {
                            inQuotes = !inQuotes
                          } else if (char === ',' && !inQuotes) {
                            result.push(current.trim())
                            current = ''
                          } else {
                            current += char
                          }
                        }
                        result.push(current.trim())
                        return result
                      }

                      const headerRow = parseCSVLine(lines[0])
                      const dataHeaders = headerRow.slice(1)
                      const trafficData: Record<string, Record<string, string | number>> = {}
                      let rowCount = 0

                      for (let i = 1; i < lines.length; i++) {
                        const row = parseCSVLine(lines[i])
                        if (row.length < 2) continue

                        let slug = row[0].replace(/^\/|\/$/g, '')
                        if (!slug) slug = '/'

                        const rowData: Record<string, string | number> = {}
                        for (let j = 1; j < row.length && j < headerRow.length; j++) {
                          const value = row[j]
                          const numVal = parseFloat(value.replace(/,/g, ''))
                          rowData[headerRow[j]] = isNaN(numVal) ? value : numVal
                        }
                        trafficData[slug] = rowData
                        rowCount++
                      }

                      // Send to server
                      const form = new FormData()
                      form.append('action', 'wp_triage_save_csv')
                      form.append('nonce', window.wpTriage.nonce)
                      form.append('headers', JSON.stringify(dataHeaders))
                      form.append('data', JSON.stringify(trafficData))
                      form.append('raw_lines', JSON.stringify(lines))
                      form.append('filename', file.name)
                      form.append('row_count', String(rowCount))

                      fetch(window.wpTriage.ajaxUrl, { method: 'POST', body: form })
                        .then(r => r.json())
                        .then(res => {
                          setCsvUploading(false)
                          if (res.success) {
                            setCsvFilename(file.name)
                            setTrafficHeaders(dataHeaders)
                            setTraffic(trafficData)
                            setRawCsvLines(lines)
                            setCsvSuccess(true)
                          }
                        })
                        .catch(() => setCsvUploading(false))
                    }
                    reader.readAsText(file)
                    e.target.value = ''
                  }}
                />
              </>
            )}
          </div>
          {csvSuccess && (
            <DialogFooter>
              <Button onClick={() => setCsvUploadOpen(false)}>Done</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
