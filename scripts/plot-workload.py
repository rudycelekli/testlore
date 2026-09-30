#!/usr/bin/env python3
"""Render a measured workload receipt; requires matplotlib, never edits the input."""
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
parser=argparse.ArgumentParser()
parser.add_argument('--report',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args()
output=Path(args.output)
if output.exists():raise SystemExit('Output must be new; preserve previous charts')
report=json.loads(Path(args.report).read_text())
rows={row['method']:row for row in report['summary']}
ordered=[rows['full-native'],rows['testlore']]
if any(not row['complete'] or row['missedFailureObservations'] for row in ordered):raise SystemExit('Incomplete or missed-failure results cannot be plotted as successful')
dataset=report['dataset']
times=[row['endToEndMedianMs']/1000 for row in ordered]
files=[row['executedCallbackFiles']/dataset['repetitions'] for row in ordered]
plt.rcParams.update({'font.family':'DejaVu Sans','svg.fonttype':'none','font.size':12})
fig,axes=plt.subplots(1,2,figsize=(12,4.6),gridspec_kw={'width_ratios':[1.35,1]})
fig.patch.set_facecolor('#f6f8f2')
colors=['#6f7d79','#15746a']; labels=['Full native suite','TestLore']
for ax,values,title,unit in [(axes[0],times,'Median total time','Seconds · lower is better'),(axes[1],files,'Files with executed test callbacks','Files · lower is better')]:
 ax.set_facecolor('#f6f8f2');ax.barh(labels,values,color=colors,height=.45);ax.invert_yaxis();ax.set_title(title,loc='left',pad=18,fontweight='bold',fontsize=14);ax.set_xlabel(unit,color='#536863');ax.spines[['top','right','left']].set_visible(False);ax.spines['bottom'].set_color('#cbd5ce');ax.tick_params(axis='y',length=0);ax.tick_params(axis='x',colors='#536863');ax.set_xlim(0,max(values)*1.28)
 for i,value in enumerate(values):ax.text(value+max(values)*.035,i,f'{value:.3f} s' if ax is axes[0] else f'{value:g} / {dataset["files"]}',va='center',fontweight='bold',color='#153b36')
fig.suptitle('When test work dominates, selective execution pays off.',x=.03,y=.98,ha='left',fontsize=19,fontweight='bold',color='#153b36')
fig.text(.03,.87,f'Constructed workload · {dataset["files"]} independent Node files · {dataset["workloadMs"]} ms async callback delay · concurrency {dataset["concurrency"]} · {dataset["repetitions"]} repetitions',fontsize=10,color='#536863')
fig.text(.03,.095,'Same planted failure detected in every measured run. TestLore time includes discovery, planning and execution.',fontsize=10,color='#536863')
fig.text(.03,.045,'This constructed condition establishes no production speedup. Tiny-suite overhead and raw outcomes are also published.',fontsize=10,color='#536863')
fig.subplots_adjust(left=.145,right=.97,top=.72,bottom=.27,wspace=.66)
output.parent.mkdir(parents=True,exist_ok=True)
fig.savefig(output,facecolor=fig.get_facecolor())
plt.close(fig)
print(output)
