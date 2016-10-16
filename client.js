$(window).on('action:ajaxify.end', function () {
  $('.category [component="thread/sort"] ul').append('<li><a href="#" class="a_z" data-sort="a_z"><i class="fa fa-fw ' + (config.categoryTopicSort === 'a_z' ? 'fa-check' : '') + '"></i> A-Z</a></li>')
})
