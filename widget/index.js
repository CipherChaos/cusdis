window.CUSDIS = {}

const makeIframeContent = (target) => {
  const host = target.dataset.host || 'https://cusdis.com'
  const iframeJsPath = target.dataset.iframe || `${host}/js/iframe.umd.js`
  const cssPath = `${host}/js/style.css`
  return `<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="${cssPath}">
    <base target="_parent" />
    <link>
    <script>
      window.CUSDIS_LOCALE = ${JSON.stringify(window.CUSDIS_LOCALE)}
      window.__DATA__ = ${JSON.stringify(target.dataset)}
    <\/script>
    <style>
      :root {
        color-scheme: light;
      }
      html, body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="${iframeJsPath}" type="module"><\/script>
  </body>
</html>`
}

let singleTonIframe
let resizeCleanup

function createIframe(target) {
  if (!singleTonIframe) {
    singleTonIframe = document.createElement('iframe')
    listenEvent(singleTonIframe, target)
  }
  // srcdoc dosen't work on IE11
  singleTonIframe.srcdoc = makeIframeContent(target)
  singleTonIframe.style.width = '100%'
  singleTonIframe.style.border = '0'
  singleTonIframe.style.overflow = 'hidden'
  singleTonIframe.style.display = 'block'
  singleTonIframe.scrolling = 'no'

  return singleTonIframe
}

function postMessage(event, data) {
  if (singleTonIframe && singleTonIframe.contentWindow) {
    singleTonIframe.contentWindow.postMessage(
      JSON.stringify({
        from: 'cusdis',
        event,
        data,
      }),
      '*',
    )
  }
}

function listenEvent(iframe, target) {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')

  const onMessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.from === 'cusdis') {
        switch (msg.event) {
          case 'onload':
            {
              if (target.dataset.theme === 'auto') {
                postMessage(
                  'setTheme',
                  darkModeQuery.matches ? 'dark' : 'light',
                )
              }
            }
            break
          case 'resize':
            {
              iframe.style.height = msg.data + 'px'
            }
            break
        }
      }
    } catch (e) {}
  }

  window.addEventListener('message', onMessage)

  function onChangeColorScheme(e) {
    const isDarkMode = e.matches
    if (target.dataset.theme === 'auto') {
      postMessage('setTheme', isDarkMode ? 'dark' : 'light')
    }
  }

  darkModeQuery.addEventListener('change', onChangeColorScheme)

  return () => {
    darkModeQuery.removeEventListener('change', onChangeColorScheme)
    window.removeEventListener('message', onMessage)
  }
}

function observeIframeResize(iframe) {
  let resizeObserver
  let mutationObserver
  let intervalId

  const cleanup = () => {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (mutationObserver) {
      mutationObserver.disconnect()
      mutationObserver = null
    }
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  const updateHeight = () => {
    try {
      const doc = iframe.contentDocument
      if (!doc || !doc.body) return

      const height = Math.max(
        doc.body.scrollHeight,
        doc.body.offsetHeight,
        doc.documentElement.scrollHeight,
        doc.documentElement.offsetHeight
      )

      if (height > 0) {
        iframe.style.height = height + 'px'
      }
    } catch (e) {}
  }

  const setup = () => {
    cleanup()

    try {
      const doc = iframe.contentDocument
      if (!doc || !doc.body) return

      // Set initial height immediately
      updateHeight()

      // Watch for body resize events
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          updateHeight()
        })
        resizeObserver.observe(doc.body)
      }

      // Watch for DOM mutations that affect height (new comments, async content, etc.)
      mutationObserver = new MutationObserver(() => {
        updateHeight()
      })
      mutationObserver.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      })

      // Fallback polling for content that might not trigger observers
      intervalId = setInterval(updateHeight, 500)

      // Conserve resources: stop polling after 10 seconds
      setTimeout(() => {
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
      }, 10000)

    } catch (e) {}
  }

  // Setup when iframe content is ready
  if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
    setup()
  } else {
    iframe.addEventListener('load', setup, { once: true })
  }

  // Safety net: attempt setup after a short delay in case load event already fired
  setTimeout(() => {
    if (!resizeObserver && !mutationObserver) {
      setup()
    }
  }, 500)

  return cleanup
}

function render(target) {
  if (target) {
    target.innerHTML = ''
    const iframe = createIframe(target)
    // Clean up previous observers before creating new ones
    if (resizeCleanup) resizeCleanup()
    resizeCleanup = observeIframeResize(iframe)
    target.appendChild(iframe)
  }
}

// deprecated
window.renderCusdis = render

window.CUSDIS.renderTo = render

window.CUSDIS.setTheme = function (theme) {
  postMessage('setTheme', theme)
}

function initial() {
  let target

  if (window.cusdisElementId) {
    target = document.querySelector(`#${window.cusdisElementId}`)
  } else if (document.querySelector('#cusdis_thread')) {
    target = document.querySelector('#cusdis_thread')
  } else if (document.querySelector('#cusdis')) {
    console.warn(
      'id `cusdis` is deprecated. Please use `cusdis_thread` instead',
    )
    target = document.querySelector('#cusdis')
  }

  if (window.CUSDIS_PREVENT_INITIAL_RENDER === true) {
  } else {
    if (target) {
      render(target)
    }
  }
}

// initialize
window.CUSDIS.initial = initial

initial()
