<button id="reindex" type="button" class="btn btn-default">Re-index Topics</button>

<script>
(function(){
  var reindexing = false
  var timestamp

  $('#reindex').click(function () {
    if (reindexing) return

    reindexing = true
    timestamp = Date.now()

    app.alert({
      title: 'Sort-by-title',
      message: 'Re-indexing topics...',
      timeout: 5000
    })

    socket.emit('admin.sortbytitle.reindex', {}, function (err) {
      reindexing = false

      if (err) {
        app.alert({
          title: 'Sort-by-title',
          message: 'Error re-indexing topics:<br>' + err.message,
          timeout: 5000
        })
      } else {
        app.alert({
          title: 'Sort-by-title',
          message: 'Re-index complete!<br>Took ' + ((Date.now() - timestamp)/1000) + ' seconds.',
          timeout: 5000
        })
      }
    })
  })
}())
</script>
