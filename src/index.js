import pathToRegexp from 'path-to-regexp'
import React from 'react'
import { parse } from 'url'
import NextLink from 'next/link'
import NextRouter from 'next/router'

module.exports = opts => new Routes(opts)

class Routes {
  constructor ({
    Link = NextLink,
    Router = NextRouter,
    locales = ['en'],
    defaultLocale = 'en',
    prefix = ''
  } = {}) {
    this.routes = []
    this.Link = this.getLink(Link)
    this.Router = this.getRouter(Router)
    this.locales = locales
    this.defaultLocale = defaultLocale
    this.prefix = prefix
  }

  add (name, pattern, page, disableLocales = []) {
    let options
    let locales
    locales = this.locales.filter(item => !disableLocales.includes(item))

    if (name instanceof Object) {
      options = name
      name = options.name
    } else {
      if (name[0] === '/') {
        page = pattern
        pattern = name
        name = null
      }
      options = { name, pattern, page, defaultLocale: this.defaultLocale }
    }

    if (this.findByName(name)) {
      throw new Error(`Route "${name}" already exists`)
    }

    options.pattern = `/:lang(${locales.join('|')})?${this.prefix}${options.pattern || `/${options.name}`}`

    this.routes.push(new Route(options))
    return this
  }

  findByName (name) {
    if (name) {
      return this.routes.filter(route => route.name === name)[0]
    }
  }

  match (url) {
    const parsedUrl = parse(url, true)
    const { pathname, query } = parsedUrl

    const reducer = this.routes.reduce((result, route) => {
      if (result.route) return result
      const params = route.match(pathname)
      if (!params) return result
      return { ...result, route, params, query: { ...query, ...params } }
    }, { query, parsedUrl })

    reducer.query = {
      ...reducer.query,
      lang: reducer.query.lang ? reducer.query.lang : this.defaultLocale
    }

    return reducer
  }

  findAndGetUrls (nameOrUrl, params, language) {
    const route = this.findByName(nameOrUrl)

    if (route) {
      return { route, urls: route.getUrls(params, language), byName: true }
    } else {
      const { route, query } = this.match(nameOrUrl)
      const href = route ? route.getHref(query) : nameOrUrl
      const urls = { href, as: nameOrUrl }
      return { route, urls }
    }
  }

  getRequestHandler (app, customHandler) {
    const nextHandler = app.getRequestHandler()

    return (req, res) => {
      const { route, query, parsedUrl } = this.match(req.url)

      if (route) {
        if (customHandler) {
          customHandler({ req, res, route, query })
        } else {
          app.render(req, res, route.page, query)
        }
      } else {
        nextHandler(req, res, parsedUrl)
      }
    }
  }

  getLink (Link) {
    const LinkRoutes = props => {
      const { route, params, to, language, ...newProps } = props
      const nameOrUrl = route || to

      if (nameOrUrl) {
        Object.assign(newProps, this.findAndGetUrls(nameOrUrl, params, language).urls)
      }

      return <Link {...newProps} />
    }
    return LinkRoutes
  }

  getRouter (Router) {
    const wrap = method => (route, params, options, language) => {
      const { byName, urls: { as, href } } = this.findAndGetUrls(route, params, language)
      return Router[method](href, as, byName ? options : params)
    }

    Router.pushRoute = wrap('push')
    Router.replaceRoute = wrap('replace')
    Router.prefetchRoute = wrap('prefetch')
    return Router
  }
}

class Route {
  constructor ({ name, pattern, page = name, disableLocales = [], defaultLocale }) {
    if (!name && !page) {
      throw new Error(`Missing page to render for route "${pattern}"`)
    }

    this.name = name
    this.pattern = pattern || `/${name}`
    this.page = page.replace(/(^|\/)index$/, '').replace(/^\/?/, '/')
    this.regex = pathToRegexp(this.pattern, this.keys = [])
    this.keyNames = this.keys.map(key => key.name)
    this.toPath = pathToRegexp.compile(this.pattern)
    this.defaultLocale = defaultLocale
  }

  match (path) {
    const values = this.regex.exec(path)
    if (values) {
      return this.valuesToParams(values.slice(1))
    }
  }

  valuesToParams (values) {
    return values.reduce((params, val, i) => {
      if (val === undefined) return params
      return Object.assign(params, {
        [this.keys[i].name]: decodeURIComponent(val)
      })
    }, {})
  }

  getHref (params = {}, language) {
    const languageQuery = (language && language !== this.defaultLocale) ? `lang=${language}&` : ''
    return `${this.page}?${languageQuery}${toQuerystring(params)}`
  }

  getAs (params = {}, language) {
    const languagePath = (language && language !== this.defaultLocale) ? `/${language}` : ''
    const as = this.toPath(params) ? `${languagePath}${this.toPath(params)}` : '/'
    const keys = Object.keys(params)
    const qsKeys = keys.filter(key => this.keyNames.indexOf(key) === -1)

    if (!qsKeys.length) return as

    const qsParams = qsKeys.reduce((qs, key) => Object.assign(qs, {
      [key]: params[key]
    }), {})

    return `${as}?${toQuerystring(qsParams)}`
  }

  getUrls (params, language) {
    const as = this.getAs(params, language)
    const href = this.getHref(params, language)
    return { as, href }
  }
}

const toQuerystring = obj => Object.keys(obj)
  .filter(key => obj[key] !== null && obj[key] !== undefined)
  .map(key => {
    let value = obj[key]

    if (Array.isArray(value)) {
      value = value.join('/')
    }
    return [
      encodeURIComponent(key),
      encodeURIComponent(value)
    ].join('=')
  }).join('&')
