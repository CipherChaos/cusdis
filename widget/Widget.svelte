<script>
  import './theme.css'
  import { onMount, setContext, tick } from 'svelte'
  import axios from 'redaxios'
  import Comment from './components/Comment.svelte'
  import Reply from './components/Reply.svelte'
  import { t } from './i18n'

  export let attrs
  export let commentsResult

  let page = 0          // last successfully loaded page (0 = none yet)

  let loadingComments = true
  let loadingMoreComments = false
  let loadMoreError = null   // transient error during infinite-scroll fetches

  let message = ''

  let error

  let theme = attrs.theme || 'light'

  const api = axios.create({
    baseURL: attrs.host,
  })

  // locally-stored pending (unapproved) comments, keyed per page
  let pendingComments = []

  function pendingKey() {
    return `cusdis_pending:${attrs.appId}:${attrs.pageId}`
  }

  function loadPending() {
    try {
      pendingComments = JSON.parse(localStorage.getItem(pendingKey()) || '[]')
    } catch (e) {
      pendingComments = []
    }
  }

  function savePending() {
    try {
      localStorage.setItem(pendingKey(), JSON.stringify(pendingComments))
    } catch (e) {}
  }

  function addPending(comment) {
    pendingComments = [
      ...pendingComments,
      {
        id: comment.id,
        by_nickname: comment.by_nickname,
        content: comment.content,
        createdAt: comment.createdAt,
      },
    ]
    savePending()
  }

  function collectIds(comments, set = new Set()) {
    for (const c of comments || []) {
      set.add(c.id)
      if (c.replies && c.replies.data) collectIds(c.replies.data, set)
    }
    return set
  }

  // once a pending comment shows up in the approved list from the server,
  // drop it from localStorage so it isn't rendered twice
  function dedupPending() {
    if (!commentsResult || !commentsResult.data) return
    const approvedIds = collectIds(commentsResult.data)
    const before = pendingComments.length
    pendingComments = pendingComments.filter((p) => !approvedIds.has(p.id))
    if (pendingComments.length !== before) savePending()
  }

  function setMessage(msg) {
    message = msg
  }

  $: {
    document.documentElement.style.setProperty('color-scheme', theme)
  }

  // ---- scroll detection (driven by the parent document's scrollbar) ----

  const SCROLL_THRESHOLD_PX = 600

  // When running inside the srcdoc iframe, the iframe itself never scrolls;
  // the parent page does. We hook into the parent's scroll/resize events
  // and measure the iframe's bottom against the parent viewport.
  // When running standalone (via the SDK, not in an iframe) we fall back
  // to the window's own scroll.
  function getScrollSource() {
    try {
      if (window.parent && window.parent !== window) {
        return window.parent
      }
    } catch (e) {}
    return window
  }

  const scrollSource = getScrollSource()

  // Returns true when the bottom of the widget is close to / inside the
  // viewport, meaning the user scrolled far enough to load more.
  function shouldLoadMore() {
    try {
      const viewportHeight = scrollSource.innerHeight
      // If we are inside an iframe, measure the iframe element's rect;
      // otherwise measure the document height vs the window's scroll.
      if (scrollSource !== window && window.frameElement) {
        const rect = window.frameElement.getBoundingClientRect()
        return rect.bottom - viewportHeight < SCROLL_THRESHOLD_PX
      }
      const docHeight = document.documentElement.scrollHeight
      const scrollTop = scrollSource.scrollY
      return docHeight - (scrollTop + viewportHeight) < SCROLL_THRESHOLD_PX
    } catch (e) {
      return false
    }
  }

  function hasMore() {
    return commentsResult && commentsResult.pageCount
      ? page < commentsResult.pageCount
      : false
  }

  function onScrollCheck() {
    if (loadingComments || loadingMoreComments) return
    if (!hasMore()) return
    if (shouldLoadMore()) {
      loadMore()
    }
  }

  // ---- data fetching ----

  // A monotonically increasing token to guard against out-of-order replies.
  let fetchToken = 0

  async function getComments(p = 1, append = false) {
    const token = ++fetchToken

    if (append) {
      loadingMoreComments = true
    } else {
      loadingComments = true
      // refresh from page 1: reset paging bookkeeping so the counters
      // stay consistent with the freshly replaced list.
      page = 0
    }

    try {
      const res = await api.get(`/api/open/comments`, {
        headers: {
          'x-timezone-offset': -new Date().getTimezoneOffset(),
        },
        params: {
          page: p,
          appId: attrs.appId,
          pageId: attrs.pageId,
        },
      })
      // Ignore stale responses (e.g. a refresh fired during loadMore).
      if (token !== fetchToken) return

      const result = res.data.data
      if (append) {
        commentsResult = {
          ...result,
          data: [
            ...((commentsResult && commentsResult.data) || []),
            ...result.data,
          ],
        }
      } else {
        commentsResult = result
      }
      page = p
      loadMoreError = null
      dedupPending()
      // After the DOM update, check again: large viewports may need to
      // load several pages before the widget bottom is pushed beyond view.
      await tick()
      requestAnimationFrame(() => requestAnimationFrame(onScrollCheck))
    } catch (e) {
      if (token !== fetchToken) return
      if (append) {
        // Don't wipe an already-loaded list because a later page failed.
        loadMoreError = e
      } else {
        error = e
      }
    } finally {
      if (token === fetchToken) {
        loadingComments = false
        loadingMoreComments = false
      }
    }
  }

  function loadMore() {
    if (loadingComments || loadingMoreComments) return
    if (!hasMore()) return
    loadMoreError = null
    const nextPage = page + 1
    getComments(nextPage, true)
  }

  // Used by the reply form after submitting a new top-level comment.
  function refreshComments() {
    return getComments(1, false)
  }

  onMount(() => {

    function onMessage(e) {
      try {
        const msg = JSON.parse(e.data)
        if (msg.from === 'cusdis') {
          switch (msg.event) {
            case 'setTheme':
              {
                theme = msg.data
              }
              break
          }
        }
      } catch (e) {}
    }
    window.addEventListener('message', onMessage)

    // Hook into the scroll source so the infinite loader is driven by the
    // main page's scrollbar (the iframe itself never scrolls).
    scrollSource.addEventListener('scroll', onScrollCheck, { passive: true })
    scrollSource.addEventListener('resize', onScrollCheck)

    return () => {
      window.removeEventListener('message', onMessage)
      scrollSource.removeEventListener('scroll', onScrollCheck)
      scrollSource.removeEventListener('resize', onScrollCheck)
    }
  })

  setContext('api', api)
  setContext('attrs', attrs)
  setContext('refresh', refreshComments)
  setContext('setMessage', setMessage)
  setContext('addPending', addPending)

  onMount(() => {
    loadPending()
    getComments()
  })

</script>

{#if !error}
  <div class:dark={theme === 'dark'}>
    {#if message}
      <div class="p-2 mb-4 bg-blue-500 text-white">
        {message}
      </div>
    {/if}

    <!-- Comment input box -->
    <Reply />

    <div class="my-8" />

    <div class="mt-4 px-1">
      {#if loadingComments}
        <div class="text-gray-900 dark:text-gray-100">
          {t('loading')}...
        </div>
      {:else if commentsResult}
        {#each commentsResult.data as comment (comment.id)}
          <Comment {comment} />
        {/each}
        {#each pendingComments as pending (pending.id)}
          <div class="py-4 border-t border-gray-100 opacity-70">
            <div class="flex items-center">
              <span class="font-bold dark:text-gray-100">{pending.by_nickname}</span>
              <span
                class="ml-2 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded"
                >{t('waiting_for_approval')}</span
              >
            </div>
            <div
              class="mt-2 text-gray-800 dark:text-gray-200"
              style="white-space: pre-wrap;"
            >
              {pending.content}
            </div>
          </div>
        {/each}

        {#if hasMore()}
          <div
            class="cusdis-infinite-loader py-6 text-center text-sm text-gray-500 dark:text-gray-100"
            aria-live="polite"
          >
            {#if loadingMoreComments}
              {t('loading')}...
            {:else if loadMoreError}
              <button
                class="underline"
                on:click={loadMore}>{t('load_more_failed')}</button>
            {:else}
              <!-- sentinel element used as a scroll target -->
              <span class="opacity-0">.</span>
            {/if}
          </div>
        {/if}

        {#if commentsResult.data.length === 0 && pendingComments.length === 0}
          <div class="py-8 text-center text-sm text-gray-400 dark:text-gray-100">
            {t('no_comments')}
          </div>
        {/if}
      {/if}
    </div>

    <div class="my-8" />

    <div class="text-center text-gray-500 dark:text-gray-100 text-xs">
      <a class="underline" href="https://cusdis.com">{t('powered_by')}</a>
    </div>
  </div>
{:else}
  <div class="p-4 text-center text-red-500">
    {t('comments_error')}
  </div>
{/if}

<style>
  /* Ensure the infinite-scroll loader row always has enough height to be
     detected by the scroll math, even while waiting for content. */
  :global(.cusdis-infinite-loader) {
    min-height: 32px;
  }
</style>
