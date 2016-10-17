$(window).on('action:ajaxify.end', function () {
  var sortEl = $('.category [component="thread/sort"] ul')

  sortEl.append('<li><a href="#" class="a_z" data-sort="a_z"><i class="fa fa-fw ' + (config.categoryTopicSort === 'a_z' ? 'fa-check' : '') + '"></i> A-Z</a></li>')
  sortEl.append('<li><a href="#" class="z_a" data-sort="z_a"><i class="fa fa-fw ' + (config.categoryTopicSort === 'z_a' ? 'fa-check' : '') + '"></i> Z-A</a></li>')
})
