// Sort by Title

let Categories  = require.main.require('./src/categories')
let User        = require.main.require('./src/user')
let Topics      = require.main.require('./src/topics')
let SocketAdmin = require.main.require('./src/socket.io/admin')
let db          = require.main.require('./src/database')

let async   = require.main.require('async')
let winston = require.main.require('winston')
let nconf   = require.main.require('nconf')
let _       = require.main.require('lodash')

let utils = require.main.require('./public/src/utils')

let version = '1.6.0'

exports.init = ({app, router, middleware}) => new Promise(next => {
  winston.info('[sort-by-title] Loading sort by title...')

  const renderAdmin = (req, res) => res.render('admin/plugins/category-sort-by-title', {})
  router.get('/admin/plugins/category-sort-by-title', middleware.admin.buildHeader, renderAdmin)
  router.get('/api/admin/plugins/category-sort-by-title', renderAdmin)

  SocketAdmin.sortbytitle = {}
  SocketAdmin.sortbytitle.reindex = (socket, data, next) => reindex(next)

  next()

  if (!(nconf.get('isPrimary') === 'true' && !nconf.get('jobsDisabled'))) return

  db.get('sortbytitle', function (err, ver) {
    if (err) return
    if (ver === version) return

    reindex()
  })
})

exports.buildTopicsSortedSet = ({set, data}) => new Promise(next => {
  const { sort, cid } = data

  if (sort === 'a_z' || sort === 'z_a') set = `cid:${cid}:tids:lex`

  return next({set, data})
})

exports.getSortedSetRangeDirection = ({sort, direction}) => new Promise(next => {
  if (sort === 'z_a') {
    direction = 'rev'
    let method = 'getSortedSetRevRangeByLex'
    let min = '+'
    let max = '-'
  } else if (sort === 'a_z') {
    direction = 'lex'
    let method = 'getSortedSetRangeByLex'
    let min = '-'
    let max = '+'
  }
  return next({sort, direction})
})

exports.getTopicIds = async ({ tids, data, pinnedTids: pinnedTidsOnPage, allPinnedTids: pinnedTids, totalPinnedCount, normalTidsToGet }) => {
  return new Promise(async next => {

    const [set, direction] = await Promise.all([
      Categories.buildTopicsSortedSet(data),
      Categories.getSortedSetRangeDirection(data.sort),
    ])

    const pinnedCountOnPage = pinnedTidsOnPage.length
    const topicsPerPage = data.stop - data.start + 1
    const normalTidsToGet = Math.max(0, topicsPerPage - pinnedCountOnPage)

    if (!normalTidsToGet && data.stop !== -1) return pinnedTidsOnPage

    let start = data.start

    if (start > 0 && totalPinnedCount) {
      start -= totalPinnedCount - pinnedCountOnPage
    }

    const stop = data.stop === -1 ? data.stop : start + normalTidsToGet - 1

    let normalTids = []
    let keys = []

    const reverse = direction === 'highest-to-lowest';
    if (Array.isArray(set)) {
      const weights = set.map((s, index) => (index ? 0 : 1))
      normalTids = await db[reverse ? 'getSortedSetRevIntersect' : 'getSortedSetIntersect']({ sets: set, start: start, stop: stop, weights: weights })
    } else {
      if (data.sort === 'z_a') {
        let keys = await db['getSortedSetRevRangeByLex'](set, '+', '-', start, stop)
        keys.forEach(key => {
          tid = key.split(':')
          tid = tid[tid.length - 1]
          normalTids.push(tid)
        })
      } else if (data.sort === 'a_z') {
        keys = await db['getSortedSetRangeByLex'](set, '-', '+', start, stop)
        keys.forEach(key => {
          tid = key.split(':')
          tid = tid[tid.length - 1]
          normalTids.push(tid)
        })
      } else {
        normalTids = await db[reverse ? 'getSortedSetRevRange' : 'getSortedSetRange'](set, start, stop)
      }
    }

    normalTids = normalTids.filter(tid => !pinnedTids.includes(tid))

    const purgedTids = await db.isSetMembers('sortbytitle:purged', normalTids)
    for (let i = 0; i < keys.length; i++) {
      if (purgedTids[i]) {
        db.sortedSetRemove(set, keys[i])
        db.setRemove('sortbytitle:purged', normalTids[i])
      }
    }

    return next({ tids: pinnedTidsOnPage.concat(normalTids), data, pinnedTids: pinnedTidsOnPage, allPinnedTids: pinnedTids, totalPinnedCount, normalTidsToGet })
  })
}

function reindex(next) {
  next = next || (() => {})

  winston.info('[sort-by-title] Re-indexing topics...')

  async.waterfall([
    async.apply(db.getSortedSetRange, 'categories:cid', 0, -1),
    function (cids, next) {
      let keys = cids.map(function (cid) { return 'cid:' + cid + ':tids:lex' })

      db.deleteAll(keys, next)
    },
    async.apply(db.getSortedSetRange, 'topics:tid', 0, -1),
    function (tids, next) {
      Topics.getTopicsFields(tids, ['tid', 'cid', 'slug'], next)
    },
    function (topics, next) {
      async.each(topics, function (topic, next) {
        db.sortedSetAdd('cid:' + topic.cid + ':tids:lex', 0, topic.slug.split('/')[1] + ':' + topic.tid, next)
      }, next)
    },
    async.apply(db.set, 'sortbytitle', version),
    async.apply(db.delete, 'sortbytitle:purged')
  ], (err) => {
    next(err)
    if (err) {
      winston.error(err)
    } else {
      winston.info('[sort-by-title] Finished re-indexing topics.')
    }
  })
}

exports.topicEdit = function (data, next) {
  let topic = data.topic
  let {slug, tid, cid} = topic

  if (slug) {
    Topics.getTopicField(tid, 'slug', (err, oldSlug) => {
      if (err) return

      db.sortedSetRemove(`cid:${cid}:tids:lex`, `${oldSlug.split('/')[1]}:${tid}`)
      db.sortedSetAdd(`cid:${cid}:tids:lex`, 0, `${slug.split('/')[1]}:${tid}`)
    })
  }

  next(null, data)
}

exports.topicPost = function (data) {
  let topic = data.topic

  db.sortedSetAdd('cid:' + topic.cid + ':tids:lex', 0, topic.slug.split('/')[1] + ':' + topic.tid)
}

exports.topicPurge = function (data) {
  let tid = data.topic.tid

  db.setAdd('sortbytitle:purged', tid)
}

exports.topicMove = function (topic) {
  Topics.getTopicField(topic.tid, 'slug', function (err, slug) {
    db.sortedSetRemove('cid:' + topic.fromCid + ':tids:lex', slug.split('/')[1] + ':' + topic.tid)
    db.sortedSetAdd('cid:' + topic.toCid + ':tids:lex', 0, slug.split('/')[1] + ':' + topic.tid)
  })
}

exports.categoryDelete = function (data) {
  let cid = data.cid

  db.delete('cid:' + cid + ':tids:lex')
}

exports.adminBuild = (header, next) => {
  header.plugins.push({
    route : '/plugins/category-sort-by-title',
    icon  : 'fa-sort-alpha-asc',
    name  : 'Category Sort by Title',
  })

  next(null, header)
}

