window.chartColors = [
  'rgb(255, 99, 132)',
  'rgb(54, 162, 235)',
  'rgb(255, 159, 64)',
  'rgb(75, 192, 192)',
  'rgb(153, 102, 255)',
  'rgb(255, 205, 86)',
  'rgb(100, 100, 100)',
  'rgb(10, 200, 32)',
  'rgb(90, 250, 102)',
  'rgb(0, 0, 102)',
];

window.pointStyles = [ "cross", "triangle", "star", "circle", "rect" ]

function getDate(timestamp) {
  var yyyy = timestamp.getFullYear().toString();
  var mm = (timestamp.getMonth()+1).toString();
  var dd  = timestamp.getDate().toString();

  return yyyy + (mm[1]?mm:"0"+mm[0]) + (dd[1]?dd:"0"+dd[0]);
}

function process(data){
  var plugins = getPluginsValue();
  var configs = getConfigurationsValue();
  var i ;
  var raw = [];

  var plugintimes = {};

  for (i = 0; i < data.length; i++) {
    var conf = data[i];

    var times = {};
    var j,k;

    var configName = conf.configuration_name.split('.')[0];

    for (j = 0; j < plugins.length; j++) {
      times[plugins[j]] = new Array();
    }
    for (j = 0; j < conf.statistics.plugins.length; j++) {
      // if same plugin is called multiple times, the subsequent 
      // calls are appended with #1, #2 etc
      var basename = conf.statistics.plugins[j].name.split(" ")[0];

      if (plugins.includes(basename)) {
        times[basename].push(parseFloat(conf.statistics.plugins[j].elapsed_ms))
      }
      if (plugins.includes("plugin_average")) {
        times["plugin_average"].push(parseFloat(conf.statistics.plugins[j].elapsed_ms))
      }
      if (plugins.includes("plugin_sum")) {
        if (times["plugin_sum"].length == 0) {
          times["plugin_sum"].push(0);
        }
        times["plugin_sum"][0] += parseFloat(conf.statistics.plugins[j].elapsed_ms)
      }
    }
    raw.push(
        { "finish_time" : conf.finish_time, 
		  "configuration":  configName, 
		  "hostname" : conf.hostname,
		  "times" : times 
		  });
  }

  var daily = {}
  var perHost = (getGroupingTypeValue() == "host");

  for (i = 0; i < raw.length; i++) {
    var finishDate = getDate(new Date(Date.parse(raw[i].finish_time)))

    var key = raw[i].configuration;

    if (perHost) {
      key = raw[i].hostname;
    }

    if (daily[finishDate] === undefined) {
      // first entry for this date
      daily[finishDate] = {}
      daily[finishDate][key] = raw[i].times;
    }
    else {
      for (var k = 0; k < plugins.length; k++) {
        if (daily[finishDate][key] === undefined) {
          // first entry for this plugin for this date
          daily[finishDate][key] = raw[i].times;
        }
        else {
          daily[finishDate][key][plugins[k]] = daily[finishDate][key][plugins[k]].concat(raw[i].times[plugins[k]])
        }
      }
    }
  }
  console.log(daily)
  var stats = {}
  stats['labels'] = []

  // create list of servers at time 0
  var all_servers = []
  for (var day in daily) {
    for (var server in daily[day]) {
      all_servers.push(server)
    }
    break
  } 
  var cnt = 0
  for (var day in daily) {
    stats['labels'].push(day)
    current_servers = []
    for (var server in daily[day]) {
      current_servers.push(server)
      if (all_servers.includes(server) == false) {
        console.log("got a new server: " + server + ", create past for " + cnt + " days")
        all_servers.push(server)
        // create past for this server
        stats[server] = {}
        for (var i = 0; i < cnt; i++) {
          for (var name of plugins) {
            if (stats[server][name] === undefined) {
              stats[server][name] = {}
              stats[server][name]['mean'] = []
              stats[server][name]['percentile50'] = []
              stats[server][name]['percentile95'] = []
              stats[server][name]['percentile99'] = []
              stats[server][name]['samples'] = []
              stats[server][name]['ci_low'] = []
              stats[server][name]['ci_high'] = []
            }
          
            stats[server][name]['mean'].push(undefined)
            stats[server][name]['percentile50'].push(undefined)
            stats[server][name]['percentile95'].push(undefined)
            stats[server][name]['percentile99'].push(undefined)
            stats[server][name]['ci_low'].push(undefined)
            stats[server][name]['ci_high'].push(undefined)
            stats[server][name]['samples'].push(0)
          }
        }
      }
      for (var name in daily[day][server]) {
        if (stats[server] === undefined) {
          stats[server] = {}
        }

        if (stats[server][name] === undefined) {
          stats[server][name] = {}
          stats[server][name]['mean'] = []
          stats[server][name]['percentile50'] = []
          stats[server][name]['percentile95'] = []
          stats[server][name]['percentile99'] = []
          stats[server][name]['samples'] = []
          stats[server][name]['ci_low'] = []
          stats[server][name]['ci_high'] = []
        }
        var mean = jStat.mean(daily[day][server][name])

        stats[server][name]['mean'].push((mean / 1000).toFixed(1))
        stats[server][name]['percentile50'].push((jStat.percentile(daily[day][server][name], 0.5) / 1000).toFixed(1));
        stats[server][name]['percentile95'].push((jStat.percentile(daily[day][server][name], 0.95) / 1000).toFixed(1));
        stats[server][name]['percentile99'].push((jStat.percentile(daily[day][server][name], 0.99) / 1000).toFixed(1));
        stats[server][name]['samples'].push(daily[day][server][name].length);
        var ci = jStat.normalci(mean, 0.05, daily[day][server][name])
        stats[server][name]["ci_low"].push((ci[0] / 1000).toFixed(1))
        stats[server][name]["ci_high"].push((ci[1] / 1000).toFixed(1))
      }
    }

    // check if some of servers were undefined for this day,
    // and if so, add placeholders to timeseries
    for (aserver of all_servers) {
      found = false
      for (var cserver of current_servers) {
        if (aserver == cserver) {
          found = true
          break
        }
      }

      if (found == false) {
        console.log("did not find " + aserver + " for day " + day)
        for (var name of plugins) {
          stats[aserver][name]['mean'].push(undefined)
          stats[aserver][name]['percentile50'].push(undefined)
          stats[aserver][name]['percentile95'].push(undefined)
          stats[aserver][name]['percentile99'].push(undefined)
          stats[aserver][name]['ci_low'].push(undefined)
          stats[aserver][name]['ci_high'].push(undefined)
          stats[aserver][name]['samples'].push(0)
        }
      }
    }
    cnt++;
  }

  createChart(stats);
}

function dateForPastDays(pastDays) {
  var d = new Date()
  return new Date(d.getTime() - 1000 * pastDays * 24 * 60 * 60)
}

function getPastDaysValue() {
  var radios = document.getElementsByName("pastdays");

  for (var i = 0; i < radios.length; i++) {
    if (radios[i].checked) {
      return radios[i].value;
    }
  }
}

function getPluginsValue() {
  var plugins = document.getElementsByName("plugin");
  var ret = [];

  for (var i = 0; i < plugins.length; i++)
  {
    if (plugins[i].checked) {
      ret.push(plugins[i].value);
    }
  }
  return ret
}

function getConfigurationsValue() {
  var configs = document.getElementsByName("configuration");
  var ret = [];

  for (var i = 0; i < configs.length; i++)
  {
    if (configs[i].checked) {
      ret.push(configs[i].value);
    }
  }
  return ret
}

function getDisplayTypeValue() {
  var radios = document.getElementsByName("display_type");

  for (var i = 0; i < radios.length; i++) {
    if (radios[i].checked) {
      return radios[i].value;
    }
  }
}

function getGroupingTypeValue() {
  var radios = document.getElementsByName("grouping_type");

  for (var i = 0; i < radios.length; i++) {
    if (radios[i].checked) {
      return radios[i].value;
    }
  }
}

function fetchFromDatabase(pastDays) {
  var pastDays = getPastDaysValue();
  var plugins = getPluginsValue();
  var configs = getConfigurationsValue();

  if (plugins.length == 0 || configs.length == 0) {
    return;
  }

  var url = "http://localhost:3000/himan_run_statistics?";
  
  url += "and=(finish_time.gt." + dateForPastDays(pastDays).toISOString() + ",or(";

  for (var i = 0; i < configs.length; i++) {
    url += "configuration_name.like." + configs[i] + ".*,";
  }

  url = url.slice(0, -1)
  url += "))"

  console.log(url)

  fetch(url, {
    mode: 'cors',
    headers: { 'Access-Control-Allow-Headers' :  '*' }
  }).then(response => {
    return response.json();
  }).then(data => {
    process(data);
  }).catch(err => {
    console.log(err);
  });
}

function createChart(stats) {

  var backgroundColor = 'white';
  Chart.plugins.register({
    beforeDraw: function(c) {
        var ctx = c.chart.ctx;
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, c.chart.width, c.chart.height);
    }
  });


  // remove old canvas before creating a new one
  var old = document.getElementById("myChart");

  if (old !== undefined && old != null) {
    old.remove();
    var _canvas = document.createElement('canvas');
    _canvas.id = "myChart";

    document.getElementById("myDiv").appendChild(_canvas);
  }

  var canvas = document.getElementById("myChart")
  var ctx = canvas.getContext('2d');

  var perHost = (getGroupingTypeValue() == "host");
  var pastDays = getPastDaysValue()
  var configs = getConfigurationsValue();
  var displayType = getDisplayTypeValue();

  var title;

  if (perHost == false) {
    title = "Himan mean runtimes for " + configs + " for the past " + pastDays + " days";
    if (displayType == "fractiles") {
      title = "Himan runtimes for " + configs + " for the past " + pastDays + " days";
	}
  }
  else if (perHost) {
    title = "Himan mean runtimes for " + configs + "/" + getPluginsValue() + " for the past " + pastDays + " days";

	if (displayType == "fractiles") {
      title = "Himan 95th percentile runtimes for " + configs + "/" + getPluginsValue() + " for the past " + pastDays + " days";
	}
  }
  // perHost does not have samples, remove second y-axis in that case
  var yAxes = [{
          type: 'linear',
          display: true,
          position: 'left',
          id: 'y-axis-1',
          scaleLabel: {
            display: true,
            labelString: 'time (s)'
          }
        }]
		
  if (perHost == false) {
    yAxes.push(
        {
          type: 'linear',
          display: true,
          position: 'right',
          id: 'y-axis-2',
          scaleLabel: {
            display: true,
            labelString: 'sample size'
          }
        }
      );
  }

  var chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: stats['labels']
    },
    legend: {
      display: true,
      labels: {
        usePointStyle: true,
      }
    },
    options: {
      legend: {
        labels: {
          display: true,
            usePointStyle: true,
          filter: function(item, chart) {
            return !item.text.includes("ci_")
          }
        }
      },
      title: {
        display: true,
        text: title
      },
      scales: {
        xAxes: [{
          display: true,
          scaleLabel: {
            display: true,
            labelString: 'Date'
          }
        }],
        yAxes: yAxes,
      },
      elements: {
        line: {
          tension: 0 // disable bezier curve
        }
      },
      responsive: true
    }

  });

  var i = 0;
  var color = Chart.helpers.color;

  for (config in stats) {
    if (config == "labels" ) {
      continue
    }
	var stub = config + "/";

	if (configs.length == 1) {
	  // if only single configuration selected, do not put the name in to chart legend
      stub = "";
	}
    if (displayType == "confidence") {
      for (plugin in stats[config]) {
	    
		labelTxt = stub + plugin;

	    if (perHost) {
          labelTxt = config.split(".")[0];
		}

        chart.data.datasets.push(
          {
          label: labelTxt, //stub + plugin + ": Mean",
          fill: false,
          yAxisID: 'y-axis-1',
          borderColor: window.chartColors[i], // 'rgb(0, 0, 0)', //window.chartColors[i],
          borderWidth: '2',
          pointRadius: '6',
          backgroundColor: color(window.chartColors[i]).alpha(0.5).rgbString(),
          type: 'line',
          pointStyle: 'line',
          data: stats[config][plugin]['mean']
         }    
        );
		if (perHost == false) {
        chart.data.datasets.push(
          {
          label: plugin + ": ci_low",
          fill: false,
          yAxisID: 'y-axis-1',
          borderColor: color(window.chartColors[i]).alpha(0.6).rgbString(),
          borderWidth: 1,
          pointRadius: 0,
          backgroundColor: color(window.chartColors[i]).alpha(0.2).rgbString(),
          data: stats[config][plugin]['ci_low'],
          }    
        );
        chart.data.datasets.push(
          {
          label: plugin + ": ci_high",
          fill: '-1',
          yAxisID: 'y-axis-1',
          borderColor: color(window.chartColors[i]).alpha(0.6).rgbString(),
          borderWidth: 1,
          pointRadius: 0,
          backgroundColor: color(window.chartColors[i]).alpha(0.2).rgbString(),
          data: stats[config][plugin]['ci_high'],
          }    
        );
		}
        i++;
      }

  	  // Samples only outputted per configuration and only if in "configuration mode"
      if (!perHost) {
        chart.data.datasets.push(
        {
        label: stub + ": Samples",
        fill: false,
        yAxisID: 'y-axis-2',
        borderColor: 'rgb(201, 203, 207)', // grey
        backgroundColor: color('rgb(201, 203, 207)').alpha(0.5).rgbString(),
        showLine: false,
        pointRadius: 5,
        data: stats[config][plugin]['samples'],
        pointStyle: window.pointStyles[i]
        }
        ); 
      }
    }
	else if (displayType == "fractiles") {
      for (plugin in stats[config]) {
		labelTxt = stub + plugin + ": 95th perc" ;

	    if (perHost) {
          labelTxt = config.split(".")[0];
		}

        if (!perHost) {
          chart.data.datasets.push(
          {
          label: stub + plugin + ": Median",
          fill: false,
          yAxisID: 'y-axis-1',
          borderColor: window.chartColors[i],
          backgroundColor: color(window.chartColors[i]).alpha(0.5).rgbString(),
          data: stats[config][plugin]['percentile50']
          }
 	      );
		}
        chart.data.datasets.push(
        {
          label: labelTxt, // + stub + plugin + ": 95th perc",
          fill: false,
          yAxisID: 'y-axis-1',
          borderColor: window.chartColors[i],
		  borderDash: [5, 5],
		  pointRadius: 0,
          backgroundColor: color(window.chartColors[i]).alpha(0.5).rgbString(),
          data: stats[config][plugin]['percentile95']
        }
 	    );
		if (!perHost) {
        chart.data.datasets.push(
        {
          label: stub + plugin + ": 99th perc",
          fill: false,
          yAxisID: 'y-axis-1',
          borderColor: window.chartColors[i],
		  borderDash: [5,5],
		  borderWidth: 1,
		  pointRadius: 0,
          backgroundColor: color(window.chartColors[i]).alpha(0.5).rgbString(),
          data: stats[config][plugin]['percentile99']
        }
 	    );
        }
	    i++;
	  }
	  if (!perHost) {
        chart.data.datasets.push(
        {
        label: config + ": Samples",
        fill: false,
        yAxisID: 'y-axis-2',
        borderColor: 'rgb(201, 203, 207)',
        backgroundColor: color('rgb(201, 203, 207)').alpha(0.5).rgbString(),
        showLine: false,
        pointRadius: 5,
        data: stats[config][plugin]['samples'],
        pointStyle: window.pointStyles[i]
        }
      ); 
	}
	}
  }
  chart.update();
}

