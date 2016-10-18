// Sort by Title

var Categories = require.main.require('./src/categories')
var User = require.main.require('./src/user')
var Topics = require.main.require('./src/topics')
var SocketAdmin = require.main.require('./src/socket.io/admin')
var db = require.main.require('./src/database')

var async = require.main.require('async')
var winston = require.main.require('winston')
var nconf = require.main.require('nconf')

var utils = require.main.require('./public/src/utils')

var version = '1.0.0'

exports.init = (params, next) => {
  winston.info('[sort-by-title] Loading sort by title...')

  params.router.get('/admin/plugins/category-sort-by-title', params.middleware.admin.buildHeader, renderAdmin)
  params.router.get('/api/admin/plugins/category-sort-by-title', renderAdmin)

  function renderAdmin (req, res, next) {
    res.render('admin/plugins/category-sort-by-title', {})
  }

  var getTopicIds = Categories.getTopicIds

  Categories.getTopicIds = function (set, reverse, start, stop, callback) {
    if (!!set.match(/^cid:\d+:tids:lex$/)) {
      var method, min, max

      if (reverse && !!db.getSortedSetRevRangeByLex) {
        method = 'getSortedSetRevRangeByLex'
        min = '+'
        max = '-'
      } else {
        method = 'getSortedSetRangeByLex'
        min = '-'
        max = '+'
      }

      db[method](set, min, max, start, stop - start, function (err, topicValues) {
        var tids = []

        topicValues.forEach(function (value) {
          tid = value.split(':')
          tid = tid[tid.length - 1]
          tids.push(tid)
        })

        callback(null, tids)

        db.isSetMembers('sortbytitle:purged', tids, function (err, isMember) {
          for (var i = 0; i < topicValues.length; i++) {
            if (isMember[i]) {
              db.sortedSetRemove(set, topicValues[i])
              db.setRemove('sortbytitle:purged', tids[i])
            }
          }
        })
      })
    } else {
      getTopicIds(set, reverse, start, stop, callback)
    }
  }

  SocketAdmin.sortbytitle = {}
  SocketAdmin.sortbytitle.reindex = (socket, data, next) => {
    reindex(next)
  }

  next()

  if (!(nconf.get('isPrimary') === 'true' && !nconf.get('jobsDisabled'))) return

  db.get('sortbytitle', function (err, ver) {
    if (err) return
    if (ver === version) return

    reindex()
  })
}

function reindex(next) {
  next = next || () => {}

  winston.info('[sort-by-title] Re-indexing topics...')

  async.waterfall([
    async.apply(db.getSortedSetRange, 'categories:cid', 0, -1),
    function (cids, next) {
      var keys = cids.map(function (cid) { return 'cid:' + cid + ':tids:lex' })

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

exports.prepare = function (data, next) {
  User.getSettings(data.uid, function (err, settings) {
    if (settings.categoryTopicSort === 'a_z') {
      data.set = 'cid:' + data.cid + ':tids:lex'
      data.reverse = false
    }

    if (settings.categoryTopicSort === 'z_a') {
      data.set = 'cid:' + data.cid + ':tids:lex'
      data.reverse = true
    }

    next(null, data)
  })
}

exports.topicEdit = function (data, next) {
  var topic = data.topic

  Topics.getTopicField(topic.tid, 'title', function (err, title) {
    if (title !== topic.title) {
      var oldSlug = utils.slugify(title) || 'topic'

      db.sortedSetRemove('cid:' + topic.cid + ':tids:lex', oldSlug + ':' + topic.tid)
      db.sortedSetAdd('cid:' + topic.cid + ':tids:lex', 0, topic.slug.split('/')[1] + ':' + topic.tid)
    }

    next(null, data)
  })
}

exports.topicPost = function (topic) {
  db.sortedSetAdd('cid:' + topic.cid + ':tids:lex', 0, topic.slug.split('/')[1] + ':' + topic.tid)
}

exports.topicPurge = function (tid) {
  db.setAdd('sortbytitle:purged', tid)
}

exports.topicMove = function (topic) {
  Topics.getTopicField(topic.tid, 'slug', function (err, slug) {
    db.sortedSetRemove('cid:' + topic.fromCid + ':tids:lex', slug.split('/')[1] + ':' + topic.tid)
    db.sortedSetAdd('cid:' + topic.toCid + ':tids:lex', 0, slug.split('/')[1] + ':' + topic.tid)
  })
}

exports.categoryDelete = function (cid) {
  db.delete('cid:' + cid + ':tids:lex')
}

exports.adminBuild = (header, next) => {
  header.plugins.push({
    route : '/plugins/category-sort-by-title',
    icon  : 'fa-sort-alpha-asc',
    name  : 'Category Sort by Title'
  })

  next(null, header)
}
